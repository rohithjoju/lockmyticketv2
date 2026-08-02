import { getEnv } from '@event-ticketing/config';
import { sql } from '../db/transaction.ts';
import { AppError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import { fetchOrderPayments } from '../lib/razorpay.ts';
import { repairPayment } from '../services/payment.service.ts';

const env = getEnv();

/** §9 — more than this in one run is a systemic fault, not bad luck. */
const ORPHAN_ALERT_THRESHOLD = 10;

/** Recorded on payments whose money landed but whose seats did not. */
export const ORPHANED_CAPTURE_REASON = 'orphaned_capture:reservation_expired';

export type ReconcileReport = {
  checked: number;
  repaired: number;
  orphansFound: number;
  flaggedForRefund: number;
};

export type ReconcileOptions = {
  /**
   * How stale a `pending` payment must be before we go and ask Razorpay about
   * it. Defaults to the reservation TTL — before that, the user is probably
   * still typing their card number.
   */
  pendingOlderThanMinutes?: number;
  limit?: number;
};

/**
 * Repairs payments whose database state and Razorpay state disagree (§7.6).
 *
 * Two failures produce that disagreement:
 *
 *   (a) captured here, but no confirmed tickets — the confirmation transaction
 *       committed the payment and then something ate the tickets. Re-run
 *       confirmation locally.
 *   (b) still pending here — the process died mid-confirmPayment (F2) or the
 *       client closed the browser and no webhook arrived (F5). Razorpay is
 *       asked who is right.
 *
 * Anything captured upstream whose reservation has since lapsed is flagged for
 * auto-refund rather than confirmed (F6): the seats are gone, so the only
 * honest outcome is giving the money back.
 */
export async function runReconcilePayments(
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const staleMinutes = options.pendingOlderThanMinutes ?? env.RESERVATION_TTL_MINUTES;
  const limit = options.limit ?? 200;

  const report: ReconcileReport = {
    checked: 0,
    repaired: 0,
    orphansFound: 0,
    flaggedForRefund: 0,
  };

  // ---- (a) captured, but nothing to show for it
  const orphaned = (await sql`
    select p.id, p.razorpay_order_id, p.razorpay_payment_id, p.payment_method
      from payments p
     where p.status = 'captured'
       and p.failure_reason is null
       and not exists (
         select 1 from tickets t
          where t.payment_id = p.id and t.reservation_status = 'confirmed'
       )
     order by p.created_at asc
     limit ${limit}
  `) as Array<{
    id: string;
    razorpay_order_id: string;
    razorpay_payment_id: string | null;
    payment_method: string | null;
  }>;

  report.checked += orphaned.length;
  report.orphansFound = orphaned.length;

  for (const payment of orphaned) {
    if (!payment.razorpay_payment_id) {
      // Captured with no upstream id should be impossible; flag rather than
      // guess, so an admin sees it.
      await flagForRefund(payment.id, 'captured payment has no razorpay_payment_id');
      report.flaggedForRefund++;
      continue;
    }

    const outcome = await tryRepair({
      razorpayOrderId: payment.razorpay_order_id,
      razorpayPaymentId: payment.razorpay_payment_id,
      paymentMethod: payment.payment_method,
      paymentId: payment.id,
    });

    if (outcome === 'repaired') report.repaired++;
    if (outcome === 'flagged') report.flaggedForRefund++;
  }

  // ---- (b) still pending long after the user should have finished
  const stale = (await sql`
    select id, razorpay_order_id
      from payments
     where status = 'pending'
       and created_at < now() - make_interval(mins => ${staleMinutes}::integer)
     order by created_at asc
     limit ${limit}
  `) as Array<{ id: string; razorpay_order_id: string }>;

  report.checked += stale.length;

  for (const payment of stale) {
    let upstream;
    try {
      upstream = await fetchOrderPayments(payment.razorpay_order_id);
    } catch (err) {
      // Razorpay being down is not this job's problem to solve; the next run
      // will ask again.
      logger.warn(
        { orderId: payment.razorpay_order_id, err: (err as Error).message },
        'could not reach razorpay during reconciliation',
      );
      continue;
    }

    const captured = upstream.find((p) => p.status === 'captured' || p.status === 'authorized');
    if (!captured) continue;

    // Money moved upstream while our side still says pending — this is the
    // orphan the alert threshold is about.
    report.orphansFound++;

    const outcome = await tryRepair({
      razorpayOrderId: payment.razorpay_order_id,
      razorpayPaymentId: captured.id,
      paymentMethod: captured.method ?? null,
      paymentId: payment.id,
    });

    if (outcome === 'repaired') report.repaired++;
    if (outcome === 'flagged') report.flaggedForRefund++;
  }

  if (report.orphansFound > ORPHAN_ALERT_THRESHOLD) {
    logger.error(
      { ...report, threshold: ORPHAN_ALERT_THRESHOLD },
      'payment reconciliation found more orphans than the alert threshold',
    );
  } else if (report.repaired > 0 || report.flaggedForRefund > 0) {
    logger.warn(report, 'payment reconciliation made repairs');
  }

  return report;
}

async function tryRepair(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  paymentMethod: string | null;
  paymentId: string;
}): Promise<'repaired' | 'flagged' | 'noop'> {
  try {
    const result = await repairPayment({
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      paymentMethod: input.paymentMethod,
    });
    if (result.alreadyProcessed) return 'noop';

    logger.warn({ paymentId: input.paymentId }, 'repaired a payment that had lost its tickets');
    return 'repaired';
  } catch (err) {
    if (err instanceof AppError && err.code === 'RESERVATION_EXPIRED') {
      // F6 — captured but unfulfillable. Record it so the money is visible and
      // (a) stops picking it up on every subsequent run.
      await flagForRefund(input.paymentId, ORPHANED_CAPTURE_REASON, input.razorpayPaymentId);
      return 'flagged';
    }
    logger.error(
      { paymentId: input.paymentId, err: (err as Error).message },
      'reconciliation could not repair a payment',
    );
    return 'noop';
  }
}

async function flagForRefund(
  paymentId: string,
  reason: string,
  razorpayPaymentId?: string,
): Promise<void> {
  await sql`
    update payments
       set status              = 'captured',
           failure_reason      = ${reason},
           razorpay_payment_id = coalesce(razorpay_payment_id, ${razorpayPaymentId ?? null})
     where id = ${paymentId}
  `;
  logger.error({ paymentId, reason }, 'payment flagged for auto-refund');
}
