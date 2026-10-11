import type { PaymentStatus } from '@event-ticketing/types';
import { sql, uuidArray, withTransaction, type Tx } from '../db/transaction.ts';
import { AppError } from '../lib/errors.ts';
import { signQrToken } from '../lib/jwt.ts';
import { logger } from '../lib/logger.ts';
import { createOrder, isValidPaymentSignature, RAZORPAY_KEY_ID } from '../lib/razorpay.ts';
import { emailQueue, enqueueBestEffort, jobIds } from '../queues/index.ts';
import type { Actor } from './event.service.ts';

/** §8 — a user may hold at most 3 unpaid orders at once. */
const MAX_PENDING_ORDERS_PER_USER = 3;

export type ConfirmedTicket = {
  id: string;
  eventId: string;
  ticketType: string;
  qrToken: string | null;
};

export type ConfirmedPurchase = {
  paymentId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  status: PaymentStatus;
  amount: number;
  /** True when the idempotency gate short-circuited (R3). */
  alreadyProcessed: boolean;
  tickets: ConfirmedTicket[];
};

export type PaymentOrder = {
  paymentId: string;
  orderId: string;
  razorpayOrderId: string;
  keyId: string;
  amount: number;
  currency: string;
  ticketIds: string[];
  expiresAt: string;
};

type PaymentRow = {
  id: string;
  user_id: string;
  event_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  razorpay_signature: string | null;
  amount: string | number;
  currency: string;
  status: PaymentStatus;
  payment_method: string | null;
  failure_reason: string | null;
  webhook_processed: boolean;
  webhook_received_at: string | Date | null;
  created_at: string | Date;
};

type TicketRow = {
  id: string;
  event_id: string;
  qr_nonce: string;
  reservation_status: string;
  qr_jwt_token: string | null;
  ticket_type_name: string;
};

// ------------------------------------------------------------ order creation

/**
 * Create a Razorpay order against an active reservation (§6.3
 * POST /payments/order).
 *
 * The Razorpay call happens outside the transaction (R5) — a slow upstream
 * must not hold a row lock. If the database write then fails, all that is left
 * behind is an unpaid order, which Razorpay expires on its own.
 */
export async function createPaymentOrder(input: {
  userId: string;
  ticketIds: string[];
}): Promise<PaymentOrder> {
  if (input.ticketIds.length === 0) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'At least one ticket is required.',
      field: 'ticketIds',
    });
  }

  const tickets = (await sql`
    select t.id, t.user_id, t.event_id, t.payment_id, t.reservation_status,
           t.reservation_expires_at, td.price
      from tickets t
      join ticket_descriptions td on td.id = t.ticket_description_id
     where t.id = any(${uuidArray(input.ticketIds)}::uuid[])
  `) as Array<{
    id: string;
    user_id: string;
    event_id: string;
    payment_id: string | null;
    reservation_status: string;
    reservation_expires_at: string | Date;
    price: string | number;
  }>;

  if (tickets.length !== input.ticketIds.length) throw new AppError('NOT_FOUND');
  if (tickets.some((t) => t.user_id !== input.userId)) throw new AppError('FORBIDDEN');

  const eventId = tickets[0]!.event_id;
  if (tickets.some((t) => t.event_id !== eventId)) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'All tickets in one order must belong to the same event.',
      field: 'ticketIds',
    });
  }

  if (tickets.some((t) => t.reservation_status !== 'reserved')) {
    // 'expired' is the common case; 'confirmed' means the client is retrying
    // an order for tickets it already paid for.
    throw new AppError('RESERVATION_EXPIRED');
  }

  const expiresAt = new Date(
    Math.min(...tickets.map((t) => new Date(t.reservation_expires_at).getTime())),
  );
  if (expiresAt.getTime() <= Date.now()) throw new AppError('RESERVATION_EXPIRED');

  // Retry-safe: an order already covering exactly these tickets is returned
  // rather than duplicated, so a double-tap on "Pay" cannot open two orders.
  const existingId = tickets[0]!.payment_id;
  if (existingId && tickets.every((t) => t.payment_id === existingId)) {
    const rows = (await sql`
      select id, razorpay_order_id, amount, currency, status
        from payments where id = ${existingId}
    `) as Array<Pick<PaymentRow, 'id' | 'razorpay_order_id' | 'amount' | 'currency' | 'status'>>;

    const existing = rows[0];
    if (existing && existing.status === 'pending') {
      return {
        paymentId: existing.id,
        orderId: existing.razorpay_order_id,
        razorpayOrderId: existing.razorpay_order_id,
        keyId: RAZORPAY_KEY_ID,
        amount: Number(existing.amount),
        currency: existing.currency,
        ticketIds: tickets.map((t) => t.id),
        expiresAt: expiresAt.toISOString(),
      };
    }
  }

  const pending = (await sql`
    select count(*)::int as n from payments
     where user_id = ${input.userId} and status = 'pending'
  `) as Array<{ n: number }>;

  if ((pending[0]?.n ?? 0) >= MAX_PENDING_ORDERS_PER_USER) {
    throw new AppError('RATE_LIMITED', {
      message: `You already have ${MAX_PENDING_ORDERS_PER_USER} unpaid orders. Complete or cancel one first.`,
      headers: { 'retry-after': '60' },
    });
  }

  const amount = Number(
    tickets.reduce((sum, t) => sum + Number(t.price), 0).toFixed(2),
  );
  if (amount <= 0) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Free tickets do not require payment.',
      field: 'ticketIds',
    });
  }

  const order = await createOrder({
    amountRupees: amount,
    receipt: `evt_${eventId.slice(0, 8)}_${Date.now()}`,
    notes: { userId: input.userId, eventId },
  });

  return withTransaction(async (tx) => {
    // Re-read under a lock: the TTL may have lapsed while Razorpay was slow.
    const locked = (await tx`
      select id, reservation_status from tickets
       where id = any(${uuidArray(input.ticketIds)}::uuid[])
       for update
    `) as Array<{ id: string; reservation_status: string }>;

    if (locked.some((t) => t.reservation_status !== 'reserved')) {
      throw new AppError('RESERVATION_EXPIRED');
    }

    const inserted = (await tx`
      insert into payments (user_id, event_id, razorpay_order_id, amount, currency, status)
      values (${input.userId}, ${eventId}, ${order.id}, ${amount}, 'INR', 'pending')
      returning id
    `) as Array<{ id: string }>;

    const paymentId = inserted[0]!.id;

    // Linking here is what lets confirmPayment find "the associated tickets"
    // (§7.2 step 5) from nothing but the order id a webhook carries.
    await tx`
      update tickets set payment_id = ${paymentId}
       where id = any(${uuidArray(input.ticketIds)}::uuid[])
    `;

    return {
      paymentId,
      orderId: order.id,
      razorpayOrderId: order.id,
      keyId: RAZORPAY_KEY_ID,
      amount,
      currency: 'INR',
      ticketIds: input.ticketIds,
      expiresAt: expiresAt.toISOString(),
    };
  });
}

// -------------------------------------------------------------- confirmation

/**
 * Steps 2–8 of §7.2, inside one transaction (R2).
 *
 * Shared by confirmPayment() and by the reconciliation repair path. Signature
 * verification is *not* here: it belongs before the transaction opens, and the
 * repair path authenticates differently (it asks Razorpay directly).
 */
async function confirmInTx(
  tx: Tx,
  input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string | null;
    source: 'client' | 'webhook' | 'reconcile';
    paymentMethod?: string | null | undefined;
  },
): Promise<ConfirmedPurchase> {
  const payments = (await tx`
    select * from payments where razorpay_order_id = ${input.razorpayOrderId} for update
  `) as PaymentRow[];

  const payment = payments[0];
  if (!payment) throw new AppError('NOT_FOUND', { message: 'No order matches that id.' });

  const tickets = (await tx`
    select t.id, t.event_id, t.qr_nonce, t.reservation_status, t.qr_jwt_token,
           td.ticket_type_name
      from tickets t
      join ticket_descriptions td on td.id = t.ticket_description_id
     where t.payment_id = ${payment.id}
     order by t.created_at asc, t.id asc
       for update of t
  `) as TicketRow[];

  // R3 — the idempotency gate. A duplicate webhook, a retried client call, and
  // the two racing each other all land here and leave with the same answer.
  // Nothing is re-signed and no email is re-queued.
  if (payment.status === 'captured') {
    if (input.source === 'webhook' && !payment.webhook_processed) {
      // Not a duplicate side effect: it records that Razorpay's own
      // notification arrived, which is what reconciliation looks for.
      await tx`
        update payments
           set webhook_processed = true, webhook_received_at = now()
         where id = ${payment.id}
      `;
    }
    return toPurchase(payment, tickets, true);
  }

  if (payment.status === 'refunded') {
    throw new AppError('PAYMENT_ALREADY_PROCESSED', {
      message: 'This payment has already been refunded.',
    });
  }

  if (tickets.length === 0) {
    throw new AppError('NOT_FOUND', { message: 'This order has no tickets against it.' });
  }

  // §7.2 step 5. The capture may still succeed upstream; repairing that
  // orphan is reconcilePayments' job, not this transaction's (F6).
  if (tickets.some((t) => t.reservation_status !== 'reserved')) {
    throw new AppError('RESERVATION_EXPIRED');
  }

  const updated = (await tx`
    update payments set
      status              = 'captured',
      razorpay_payment_id = ${input.razorpayPaymentId},
      razorpay_signature  = ${input.razorpaySignature},
      payment_method      = ${input.paymentMethod ?? payment.payment_method},
      failure_reason      = null,
      webhook_processed   = ${input.source === 'webhook'},
      webhook_received_at = ${input.source === 'webhook' ? new Date() : payment.webhook_received_at}
    where id = ${payment.id}
    returning *
  `) as PaymentRow[];

  const confirmed: TicketRow[] = [];
  for (const ticket of tickets) {
    // Signed inside the transaction on purpose: a ticket that is confirmed but
    // has no QR is a ticket nobody can use. Local crypto, not a third party,
    // so R5 is not in play.
    const qrToken = await signQrToken({
      ticketId: ticket.id,
      eventId: ticket.event_id,
      nonce: ticket.qr_nonce,
    });

    await tx`
      update tickets
         set reservation_status = 'confirmed',
             payment_id         = ${payment.id},
             qr_jwt_token       = ${qrToken}
       where id = ${ticket.id}
    `;

    confirmed.push({ ...ticket, reservation_status: 'confirmed', qr_jwt_token: qrToken });
  }

  return toPurchase(updated[0] ?? payment, confirmed, false);
}

function toPurchase(
  payment: PaymentRow,
  tickets: TicketRow[],
  alreadyProcessed: boolean,
): ConfirmedPurchase {
  return {
    paymentId: payment.id,
    razorpayOrderId: payment.razorpay_order_id,
    razorpayPaymentId: payment.razorpay_payment_id,
    status: payment.status,
    amount: Number(payment.amount),
    alreadyProcessed,
    tickets: tickets.map((t) => ({
      id: t.id,
      eventId: t.event_id,
      ticketType: t.ticket_type_name,
      qrToken: t.qr_jwt_token,
    })),
  };
}

/**
 * The single source of truth for turning a Razorpay payment into confirmed
 * tickets (§7.2). Called by BOTH POST /payments/verify and
 * POST /payments/webhook — never reimplemented in a route handler.
 *
 * Idempotent (R3) and transactional (R2). The confirmation email is enqueued
 * after the commit, never inside it (R5).
 *
 * @throws AppError(INVALID_SIGNATURE)   — HMAC mismatch; nothing is written
 * @throws AppError(RESERVATION_EXPIRED) — TTL lapsed before payment landed
 * @throws AppError(NOT_FOUND)           — no payment for that order id
 */
export async function confirmPayment(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  source: 'client' | 'webhook';
  paymentMethod?: string | null | undefined;
}): Promise<ConfirmedPurchase> {
  // Step 1 — before touching the database. A forged callback must not even
  // cost us a row lock.
  if (!isValidPaymentSignature(input)) {
    logger.warn(
      { orderId: input.razorpayOrderId, source: input.source },
      'rejected payment callback with an invalid signature',
    );
    throw new AppError('INVALID_SIGNATURE');
  }

  const result = await withTransaction((tx) => confirmInTx(tx, input));

  // Step 9 — after commit. If Redis is down the buyer still keeps their
  // tickets; only the email is lost, and loudly (F14).
  if (!result.alreadyProcessed) {
    await enqueueBestEffort(
      emailQueue,
      'ticket_confirmation',
      {
        type: 'ticket_confirmation',
        paymentId: result.paymentId,
        userId: await userIdForPayment(result.paymentId),
        ticketIds: result.tickets.map((t) => t.id),
      },
      { jobId: jobIds.ticketConfirmation(result.paymentId) },
    );
  }

  return result;
}

async function userIdForPayment(paymentId: string): Promise<string> {
  const rows = (await sql`select user_id from payments where id = ${paymentId}`) as Array<{
    user_id: string;
  }>;
  return rows[0]!.user_id;
}

/**
 * Repair path for reconcilePayments (§7.6).
 *
 * Skips the `orderId|paymentId` HMAC because there is nothing to check it
 * against: either the signature was already verified once and the transaction
 * died afterwards, or Razorpay's own API is the thing telling us the payment
 * was captured. In both cases the authority is upstream, not the caller.
 */
export async function repairPayment(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  paymentMethod?: string | null | undefined;
}): Promise<ConfirmedPurchase> {
  const result = await withTransaction((tx) =>
    confirmInTx(tx, {
      ...input,
      razorpaySignature: null,
      source: 'reconcile',
    }),
  );

  if (!result.alreadyProcessed) {
    await enqueueBestEffort(
      emailQueue,
      'ticket_confirmation',
      {
        type: 'ticket_confirmation',
        paymentId: result.paymentId,
        userId: await userIdForPayment(result.paymentId),
        ticketIds: result.tickets.map((t) => t.id),
      },
      { jobId: jobIds.ticketConfirmation(result.paymentId) },
    );
  }

  return result;
}

// ------------------------------------------------------------------- reads

export type PaymentDetail = {
  id: string;
  eventId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: string | null;
  createdAt: string;
  tickets: Array<{ id: string; ticketType: string; reservationStatus: string }>;
};

/** Owner or admin only. Organizers must never see payment records (§8 PII). */
export async function getPaymentDetail(paymentId: string, actor: Actor): Promise<PaymentDetail> {
  const rows = (await sql`
    select id, user_id, event_id, razorpay_order_id, razorpay_payment_id,
           amount, currency, status, payment_method, created_at
      from payments where id = ${paymentId}
  `) as PaymentRow[];

  const payment = rows[0];
  if (!payment) throw new AppError('NOT_FOUND');
  if (payment.user_id !== actor.id && actor.role !== 'admin') throw new AppError('NOT_FOUND');

  const tickets = (await sql`
    select t.id, t.reservation_status, td.ticket_type_name
      from tickets t
      join ticket_descriptions td on td.id = t.ticket_description_id
     where t.payment_id = ${paymentId}
     order by t.created_at asc
  `) as Array<{ id: string; reservation_status: string; ticket_type_name: string }>;

  return {
    id: payment.id,
    eventId: payment.event_id,
    razorpayOrderId: payment.razorpay_order_id,
    razorpayPaymentId: payment.razorpay_payment_id,
    amount: Number(payment.amount),
    currency: payment.currency,
    status: payment.status,
    paymentMethod: payment.payment_method,
    createdAt: new Date(payment.created_at).toISOString(),
    tickets: tickets.map((t) => ({
      id: t.id,
      ticketType: t.ticket_type_name,
      reservationStatus: t.reservation_status,
    })),
  };
}
