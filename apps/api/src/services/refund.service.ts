import type { RefundPolicy, RefundReason, RefundStatus } from '@event-ticketing/types';
import { sql, withTransaction } from '../db/transaction.ts';
import { AppError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import { createRefund } from '../lib/razorpay.ts';
import { emailQueue, enqueueBestEffort, jobIds } from '../queues/index.ts';
import type { Actor } from './event.service.ts';

export type RefundDto = {
  id: string;
  ticketId: string;
  paymentId: string;
  reason: RefundReason;
  status: RefundStatus;
  amount: number;
  razorpayRefundId: string | null;
  failureReason: string | null;
  createdAt: string;
  processedAt: string | null;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * §7.5 policy resolution, from events.refund_policy:
 *   reason = 'event_cancelled'            → always 100%, policy ignored
 *   hoursUntilEvent >= full_refund_hours  → 100%
 *   hoursUntilEvent >  0                  → partial_refund_percent
 *   event already started                 → REFUND_WINDOW_CLOSED
 *
 * Exported so the policy can be tested on its own, without a payment.
 */
export function resolveRefundPercent(input: {
  policy: RefundPolicy;
  startTime: Date;
  reason: RefundReason;
  now?: Date;
}): number {
  if (input.reason === 'event_cancelled') return 100;

  const now = input.now ?? new Date();
  const hoursUntilEvent = (input.startTime.getTime() - now.getTime()) / 3_600_000;

  if (hoursUntilEvent <= 0) throw new AppError('REFUND_WINDOW_CLOSED');
  if (hoursUntilEvent >= input.policy.full_refund_hours) return 100;
  return input.policy.partial_refund_percent;
}

type RefundRow = {
  id: string;
  payment_id: string;
  ticket_id: string;
  reason: RefundReason;
  status: RefundStatus;
  razorpay_refund_id: string | null;
  amount: string | number;
  failure_reason: string | null;
  created_at: string | Date;
  processed_at: string | Date | null;
};

const iso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function toDto(row: RefundRow): RefundDto {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    paymentId: row.payment_id,
    reason: row.reason,
    status: row.status,
    amount: Number(row.amount),
    razorpayRefundId: row.razorpay_refund_id,
    failureReason: row.failure_reason,
    createdAt: iso(row.created_at),
    processedAt: row.processed_at === null ? null : iso(row.processed_at),
  };
}

/** Postgres tells us about a duplicate refund through uq_refund_per_ticket. */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string; message?: string };
  return (
    e?.code === '23505' || (e?.message ?? '').includes(constraint) || e?.constraint === constraint
  );
}

/**
 * Refund one ticket (§7.5).
 *
 * The database half is one transaction (R2): payment refunded, ticket
 * cancelled, seat restored, refunds row inserted. The Razorpay call happens
 * afterwards — if it fails the refund is recorded as `failed` with a reason and
 * can be retried, which is strictly better than losing the record of a
 * cancellation we already told the user about.
 */
export async function issueRefund(input: {
  ticketId: string;
  initiatedBy: string;
  reason: RefundReason;
}): Promise<RefundDto> {
  const created = await withTransaction(async (tx) => {
    const rows = (await tx`
      select t.id, t.user_id, t.payment_id, t.reservation_status,
             td.price, e.start_time, e.refund_policy
        from tickets t
        join ticket_descriptions td on td.id = t.ticket_description_id
        join events e on e.id = t.event_id
       where t.id = ${input.ticketId}
         for update of t
    `) as Array<{
      id: string;
      user_id: string;
      payment_id: string | null;
      reservation_status: string;
      price: string | number;
      start_time: string | Date;
      refund_policy: RefundPolicy;
    }>;

    const ticket = rows[0];
    if (!ticket) throw new AppError('NOT_FOUND');
    if (!ticket.payment_id) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'This ticket has no payment against it.',
      });
    }
    if (ticket.reservation_status === 'cancelled') throw new AppError('REFUND_ALREADY_ISSUED');
    if (ticket.reservation_status !== 'confirmed') {
      throw new AppError('VALIDATION_FAILED', {
        message: 'Only a confirmed ticket can be refunded.',
      });
    }

    const percent = resolveRefundPercent({
      policy: ticket.refund_policy,
      startTime: new Date(ticket.start_time),
      reason: input.reason,
    });

    const amount = round2((Number(ticket.price) * percent) / 100);
    if (amount <= 0) {
      // refunds.amount carries a `> 0` check: a 0% policy is not a refund,
      // it is a closed window.
      throw new AppError('REFUND_WINDOW_CLOSED', {
        message: 'This event refunds nothing at this point.',
      });
    }

    const payments = (await tx`
      select id, status, razorpay_payment_id
        from payments where id = ${ticket.payment_id} for update
    `) as Array<{ id: string; status: string; razorpay_payment_id: string | null }>;

    const payment = payments[0];
    if (!payment) throw new AppError('NOT_FOUND');
    // 'refunded' is allowed through: one payment can cover several tickets, and
    // refunding the second must not be blocked by the first.
    if (payment.status !== 'captured' && payment.status !== 'refunded') {
      throw new AppError('VALIDATION_FAILED', {
        message: 'This payment was never captured, so there is nothing to refund.',
      });
    }

    let refund: RefundRow;
    try {
      const inserted = (await tx`
        insert into refunds (payment_id, ticket_id, initiated_by, reason, amount, status)
        values (${payment.id}, ${ticket.id}, ${input.initiatedBy}, ${input.reason},
                ${amount}, 'pending')
        returning *
      `) as RefundRow[];
      refund = inserted[0]!;
    } catch (err) {
      if (isUniqueViolation(err, 'uq_refund_per_ticket')) {
        throw new AppError('REFUND_ALREADY_ISSUED');
      }
      throw err;
    }

    // R1 — the seat goes back through the DB function, under the same lock the
    // decrement used, never through an UPDATE assembled here.
    const cancelled = (await tx`
      select cancel_ticket(${ticket.id}::uuid, 'confirmed') as n
    `) as Array<{ n: number }>;

    if ((cancelled[0]?.n ?? 0) === 0) throw new AppError('REFUND_ALREADY_ISSUED');

    await tx`update payments set status = 'refunded' where id = ${payment.id}`;

    return { refund, razorpayPaymentId: payment.razorpay_payment_id, userId: ticket.user_id };
  });

  const settled = await settleWithRazorpay(created.refund, created.razorpayPaymentId);

  await enqueueBestEffort(
    emailQueue,
    'refund_issued',
    {
      type: 'refund_issued',
      refundId: settled.id,
      ticketId: settled.ticket_id,
      userId: created.userId,
    },
    { jobId: jobIds.refundIssued(settled.id) },
  );

  return toDto(settled);
}

/**
 * Post-commit Razorpay call. A failure here is recorded, not thrown: the seat
 * is already back on sale and the ticket already cancelled, so the user's
 * cancellation stands either way. `refunds.status = 'failed'` is the retry
 * handle.
 */
async function settleWithRazorpay(
  refund: RefundRow,
  razorpayPaymentId: string | null,
): Promise<RefundRow> {
  if (!razorpayPaymentId) {
    const rows = (await sql`
      update refunds
         set status = 'failed', failure_reason = 'no razorpay payment id on record'
       where id = ${refund.id}
      returning *
    `) as RefundRow[];
    return rows[0]!;
  }

  try {
    const result = await createRefund({
      razorpayPaymentId,
      amountRupees: Number(refund.amount),
      notes: { ticketId: refund.ticket_id, reason: refund.reason },
    });

    const rows = (await sql`
      update refunds
         set status = 'processed', razorpay_refund_id = ${result.id},
             failure_reason = null, processed_at = now()
       where id = ${refund.id}
      returning *
    `) as RefundRow[];
    return rows[0]!;
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ refundId: refund.id, err: message }, 'razorpay refund failed');

    const rows = (await sql`
      update refunds set status = 'failed', failure_reason = ${message}
       where id = ${refund.id}
      returning *
    `) as RefundRow[];
    return rows[0]!;
  }
}

/**
 * User-initiated refund (§6.3 POST /tickets/:id/refund). Ownership is checked
 * here as the middleware layer; RLS covers the same ground on the row (R4).
 */
export async function requestRefund(ticketId: string, actor: Actor): Promise<RefundDto> {
  const rows = (await sql`select user_id from tickets where id = ${ticketId}`) as Array<{
    user_id: string;
  }>;

  const owner = rows[0];
  if (!owner) throw new AppError('NOT_FOUND');
  if (owner.user_id !== actor.id && actor.role !== 'admin') throw new AppError('NOT_FOUND');

  return issueRefund({
    ticketId,
    initiatedBy: actor.id,
    reason: 'user_requested',
  });
}

export type BulkRefundReport = {
  eventId: string;
  attempted: number;
  refunded: number;
  failed: number;
};

/**
 * F12 — a cancelled event refunds every confirmed ticket at 100%, regardless of
 * the event's own policy. Run from the reconcile worker, not from the request
 * that cancelled the event: 500 refunds is not something to hold an HTTP
 * connection open for (R5).
 */
export async function refundEventTickets(input: {
  eventId: string;
  initiatedBy: string;
}): Promise<BulkRefundReport> {
  const tickets = (await sql`
    select id from tickets
     where event_id = ${input.eventId} and reservation_status = 'confirmed'
     order by created_at asc
  `) as Array<{ id: string }>;

  let refunded = 0;
  let failed = 0;

  for (const ticket of tickets) {
    try {
      await issueRefund({
        ticketId: ticket.id,
        initiatedBy: input.initiatedBy,
        reason: 'event_cancelled',
      });
      refunded++;
    } catch (err) {
      // One unrefundable ticket must not strand the other 499.
      failed++;
      logger.error(
        { ticketId: ticket.id, eventId: input.eventId, err: (err as Error).message },
        'bulk refund failed for ticket',
      );
    }
  }

  logger.info({ eventId: input.eventId, refunded, failed }, 'bulk refund complete');
  return { eventId: input.eventId, attempted: tickets.length, refunded, failed };
}
