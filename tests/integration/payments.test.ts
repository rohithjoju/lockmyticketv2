import { describe, expect, test, beforeAll, mock } from 'bun:test';
import { createHmac } from 'node:crypto';

// Infrastructure and process.env come from tests/helpers/setup.ts, preloaded
// before this file.
//
// Only Razorpay's *network* calls are stubbed. The HMAC helpers stay real:
// signature verification is the thing under test on this path, and faking it
// would make the INVALID_SIGNATURE and webhook tests prove nothing.
const realRazorpay = await import('../../apps/api/src/lib/razorpay.ts');

type UpstreamPayment = { id: string; status: string; amount: number; method?: string };

/** What Razorpay would say if asked about an order (drives reconciliation). */
const upstream = new Map<string, UpstreamPayment[]>();
let orderSeq = 0;
let refundSeq = 0;

mock.module('../../apps/api/src/lib/razorpay.ts', () => ({
  ...realRazorpay,
  createOrder: async (input: { amountRupees: number; receipt: string }) => ({
    id: `order_test_${++orderSeq}`,
    amount: Math.round(input.amountRupees * 100),
    currency: 'INR',
    receipt: input.receipt,
  }),
  createRefund: async (input: { amountRupees: number }) => ({
    id: `rfnd_test_${++refundSeq}`,
    status: 'processed',
    amount: Math.round(input.amountRupees * 100),
  }),
  fetchOrderPayments: async (orderId: string) => upstream.get(orderId) ?? [],
}));

const { createApp } = await import('../../apps/api/src/index.ts');
const { sql, uuidArray } = await import('../../apps/api/src/db/transaction.ts');
const { connectRedis } = await import('../../apps/api/src/db/redis.ts');
const { signAccessToken } = await import('../../apps/api/src/lib/jwt.ts');
const { emailQueue, SCHEDULES } = await import('../../apps/api/src/queues/index.ts');
const reservationService = await import('../../apps/api/src/services/reservation.service.ts');
const paymentService = await import('../../apps/api/src/services/payment.service.ts');
const refundService = await import('../../apps/api/src/services/refund.service.ts');
const ticketService = await import('../../apps/api/src/services/ticket.service.ts');
const { runExpireReservations } = await import('../../apps/api/src/jobs/expireReservations.ts');
const { runReconcilePayments } = await import('../../apps/api/src/jobs/reconcilePayments.ts');

const app = createApp();
const BASE = 'http://localhost/api/v1';
// Per-IP limiters are shared across test files through one Redis; this file
// bills its requests to its own address.
const CLIENT_IP = '203.0.113.30';

const WEBHOOK_SECRET = 'rzp_test_webhook_secret';

// Seed fixtures (supabase/migrations/0004_seed.sql)
const ORG1_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
const ORG1_USER = '22222222-2222-2222-2222-000000000001';
const ORG2_USER = '22222222-2222-2222-2222-000000000002';
const ADMIN_USER = '11111111-1111-1111-1111-111111111111';

type Envelope<T = unknown> = {
  success: boolean;
  data: T | null;
  meta: { requestId: string; cursor?: string | null } | null;
  error: { code: string; message: string; field?: string } | null;
};

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Envelope; headers: Headers }> {
  const res = await app.handle(
    new Request(`${BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': CLIENT_IP,
        ...(init.headers ?? {}),
      },
    }),
  );
  const text = await res.text();
  let body: Envelope;
  try {
    body = JSON.parse(text) as Envelope;
  } catch {
    throw new Error(`non-JSON response from ${path} (${res.status}): ${text.slice(0, 300)}`);
  }
  return { status: res.status, body, headers: res.headers };
}

/**
 * Mints an access token directly instead of logging in. Keeps these tests off
 * the /auth/login rate limiter, which is not what they are exercising.
 */
async function tokenFor(userId: string): Promise<string> {
  const rows = (await sql`select role, status from users where id = ${userId}`) as Array<{
    role: 'attendee' | 'organizer' | 'admin';
    status: 'active' | 'disabled';
  }>;
  return signAccessToken({ userId, role: rows[0]!.role, status: rows[0]!.status });
}

async function auth(userId: string): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await tokenFor(userId)}` };
}

/** A fresh attendee, so the per-user ticket cap of one test cannot bleed into another. */
async function makeUser(label: string): Promise<string> {
  const rows = (await sql`
    insert into users (name, email, password_hash, role)
    values (${label}, ${`${label}.${crypto.randomUUID()}@test.local`}, 'not-a-real-hash', 'attendee')
    returning id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

async function makeEvent(opts: {
  startsInHours: number;
  durationHours?: number;
  policy?: { full_refund_hours: number; partial_refund_percent: number };
}): Promise<string> {
  const duration = opts.durationHours ?? 3;
  const rows = (await sql`
    insert into events (organizer_id, title, city, start_time, end_time,
                        refund_policy, organizer_status_snapshot)
    values (
      ${ORG1_ID},
      ${`Phase4 ${crypto.randomUUID().slice(0, 8)}`},
      'Testville',
      now() + make_interval(secs => ${opts.startsInHours * 3600}),
      now() + make_interval(secs => ${(opts.startsInHours + duration) * 3600}),
      ${opts.policy ?? { full_refund_hours: 48, partial_refund_percent: 50 }},
      'approved'
    )
    returning id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

async function makeTicketType(eventId: string, price = 500, total = 100): Promise<string> {
  const rows = (await sql`
    insert into ticket_descriptions
      (event_id, ticket_type_name, price, total_tickets, available_tickets)
    values (${eventId}, 'Test Tier', ${price}, ${total}, ${total})
    returning id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

async function availability(ticketTypeId: string): Promise<number> {
  const rows = (await sql`
    select available_tickets from ticket_descriptions where id = ${ticketTypeId}
  `) as Array<{ available_tickets: number }>;
  return rows[0]!.available_tickets;
}

async function paymentRow(paymentId: string) {
  const rows = (await sql`select * from payments where id = ${paymentId}`) as Array<{
    status: string;
    razorpay_payment_id: string | null;
    razorpay_signature: string | null;
    webhook_processed: boolean;
    failure_reason: string | null;
  }>;
  return rows[0]!;
}

async function ticketRows(ticketIds: string[]) {
  return (await sql`
    select id, reservation_status, status, qr_jwt_token, payment_id
      from tickets where id = any(${uuidArray(ticketIds)}::uuid[]) order by id
  `) as Array<{
    id: string;
    reservation_status: string;
    status: string;
    qr_jwt_token: string | null;
    payment_id: string | null;
  }>;
}

/** Reserve + open an order, the state every confirmation test starts from. */
async function reserveAndOrder(input: {
  userId: string;
  eventId: string;
  ticketTypeId: string;
  quantity?: number;
}) {
  const reservation = await reservationService.createReservation({
    userId: input.userId,
    eventId: input.eventId,
    ticketDescriptionId: input.ticketTypeId,
    quantity: input.quantity ?? 1,
  });
  const order = await paymentService.createPaymentOrder({
    userId: input.userId,
    ticketIds: reservation.ticketIds,
  });
  return { ...order, ticketIds: reservation.ticketIds };
}

function clientCallback(orderId: string, paymentId = `pay_${crypto.randomUUID().slice(0, 12)}`) {
  return {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: realRazorpay.signPaymentPayload(orderId, paymentId),
  };
}

function webhookBody(orderId: string, paymentId: string) {
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: { id: paymentId, order_id: orderId, status: 'captured', method: 'card' },
      },
    },
  });
  return {
    body,
    signature: createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex'),
  };
}

/** No worker runs during tests, so queued jobs simply pile up and can be counted. */
async function emailJobsFor(paymentId: string) {
  const jobs = await emailQueue.getJobs(
    ['waiting', 'delayed', 'active', 'completed', 'failed', 'paused'],
    0,
    5_000,
  );
  return jobs.filter((j) => (j.data as { paymentId?: string }).paymentId === paymentId);
}

let farEvent: string;
let farTicketType: string;

beforeAll(async () => {
  await connectRedis();
  farEvent = await makeEvent({ startsInHours: 24 * 30 });
  farTicketType = await makeTicketType(farEvent, 500, 100);
});

// ============================================================ reservations

describe('§6.3 POST /events/:id/reserve', () => {
  test('decrements inventory and returns expiresAt', async () => {
    const eventId = await makeEvent({ startsInHours: 240 });
    const ticketTypeId = await makeTicketType(eventId, 800, 10);
    const userId = await makeUser('reserver');

    const before = await availability(ticketTypeId);

    const { status, body } = await call(`/events/${eventId}/reserve`, {
      method: 'POST',
      headers: await auth(userId),
      body: JSON.stringify({ ticketDescriptionId: ticketTypeId, quantity: 3 }),
    });

    expect(status).toBe(201);
    const data = body.data as { ticketIds: string[]; expiresAt: string };
    expect(data.ticketIds).toHaveLength(3);
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());

    expect(await availability(ticketTypeId)).toBe(before - 3);

    const rows = await ticketRows(data.ticketIds);
    expect(rows.every((r) => r.reservation_status === 'reserved')).toBe(true);
  });

  test('a ticket type belonging to another event is NOT_FOUND', async () => {
    const otherEvent = await makeEvent({ startsInHours: 100 });
    const userId = await makeUser('mismatch');

    const { status, body } = await call(`/events/${otherEvent}/reserve`, {
      method: 'POST',
      headers: await auth(userId),
      body: JSON.stringify({ ticketDescriptionId: farTicketType, quantity: 1 }),
    });

    expect(status).toBe(404);
    expect(body.error!.code).toBe('NOT_FOUND');
  });

  test('reserving beyond capacity is TICKET_SOLD_OUT', async () => {
    const eventId = await makeEvent({ startsInHours: 100 });
    const ticketTypeId = await makeTicketType(eventId, 100, 2);
    const userId = await makeUser('greedy');

    await expect(
      reservationService.createReservation({
        userId,
        eventId,
        ticketDescriptionId: ticketTypeId,
        quantity: 3,
      }),
    ).rejects.toMatchObject({ code: 'TICKET_SOLD_OUT' });

    // Nothing was taken on the way to the rejection.
    expect(await availability(ticketTypeId)).toBe(2);
  });

  test('the per-user cap is TICKET_LIMIT_EXCEEDED', async () => {
    const eventId = await makeEvent({ startsInHours: 100 });
    const ticketTypeId = await makeTicketType(eventId, 100, 100);
    const userId = await makeUser('hoarder');

    // MAX_TICKETS_PER_USER_PER_EVENT = 10 in the test environment.
    await reservationService.createReservation({
      userId,
      eventId,
      ticketDescriptionId: ticketTypeId,
      quantity: 10,
    });

    await expect(
      reservationService.createReservation({
        userId,
        eventId,
        ticketDescriptionId: ticketTypeId,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'TICKET_LIMIT_EXCEEDED' });
  });

  test('two concurrent reservations for one remaining ticket: exactly one wins (F1)', async () => {
    const eventId = await makeEvent({ startsInHours: 100 });
    const ticketTypeId = await makeTicketType(eventId, 100, 1);
    const [a, b] = await Promise.all([makeUser('racer-a'), makeUser('racer-b')]);

    const results = await Promise.allSettled([
      reservationService.createReservation({
        userId: a!,
        eventId,
        ticketDescriptionId: ticketTypeId,
        quantity: 1,
      }),
      reservationService.createReservation({
        userId: b!,
        eventId,
        ticketDescriptionId: ticketTypeId,
        quantity: 1,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'TICKET_SOLD_OUT',
    });
    // The invariant that actually matters: never oversold, never negative.
    expect(await availability(ticketTypeId)).toBe(0);
  });
});

describe('§6.3 DELETE /reservations/:id', () => {
  test('releasing early restores inventory', async () => {
    const eventId = await makeEvent({ startsInHours: 100 });
    const ticketTypeId = await makeTicketType(eventId, 100, 5);
    const userId = await makeUser('quitter');

    const reservation = await reservationService.createReservation({
      userId,
      eventId,
      ticketDescriptionId: ticketTypeId,
      quantity: 1,
    });
    expect(await availability(ticketTypeId)).toBe(4);

    const { status } = await call(`/reservations/${reservation.ticketIds[0]}`, {
      method: 'DELETE',
      headers: await auth(userId),
    });

    expect(status).toBe(200);
    expect(await availability(ticketTypeId)).toBe(5);

    const [ticket] = await ticketRows(reservation.ticketIds);
    expect(ticket!.reservation_status).toBe('cancelled');
  });

  test('releasing twice does not restore the seat twice', async () => {
    const eventId = await makeEvent({ startsInHours: 100 });
    const ticketTypeId = await makeTicketType(eventId, 100, 5);
    const userId = await makeUser('double-quitter');

    const reservation = await reservationService.createReservation({
      userId,
      eventId,
      ticketDescriptionId: ticketTypeId,
      quantity: 1,
    });

    const ticketId = reservation.ticketIds[0]!;
    await reservationService.releaseReservation(ticketId, { id: userId, role: 'attendee' });
    await reservationService.releaseReservation(ticketId, { id: userId, role: 'attendee' });

    expect(await availability(ticketTypeId)).toBe(5);
  });

  test("another user's reservation is FORBIDDEN", async () => {
    const eventId = await makeEvent({ startsInHours: 100 });
    const ticketTypeId = await makeTicketType(eventId, 100, 5);
    const owner = await makeUser('owner');
    const stranger = await makeUser('stranger');

    const reservation = await reservationService.createReservation({
      userId: owner,
      eventId,
      ticketDescriptionId: ticketTypeId,
      quantity: 1,
    });

    const { status, body } = await call(`/reservations/${reservation.ticketIds[0]}`, {
      method: 'DELETE',
      headers: await auth(stranger),
    });

    expect(status).toBe(403);
    expect(body.error!.code).toBe('FORBIDDEN');
    expect(await availability(ticketTypeId)).toBe(4);
  });
});

describe('§7.6 expireReservations', () => {
  test('a reservation past its TTL gives the seat back', async () => {
    const eventId = await makeEvent({ startsInHours: 100 });
    const ticketTypeId = await makeTicketType(eventId, 100, 4);
    const userId = await makeUser('lapser');

    const reservation = await reservationService.createReservation({
      userId,
      eventId,
      ticketDescriptionId: ticketTypeId,
      quantity: 2,
    });
    expect(await availability(ticketTypeId)).toBe(2);

    await sql`
      update tickets set reservation_expires_at = now() - interval '1 minute'
       where id = any(${uuidArray(reservation.ticketIds)}::uuid[])
    `;

    await runExpireReservations();

    expect(await availability(ticketTypeId)).toBe(4);
    const rows = await ticketRows(reservation.ticketIds);
    expect(rows.every((r) => r.reservation_status === 'expired')).toBe(true);
  });

  test('a second sweep does not restore the same seats again', async () => {
    const eventId = await makeEvent({ startsInHours: 100 });
    const ticketTypeId = await makeTicketType(eventId, 100, 3);
    const userId = await makeUser('lapser-2');

    const reservation = await reservationService.createReservation({
      userId,
      eventId,
      ticketDescriptionId: ticketTypeId,
      quantity: 1,
    });
    await sql`
      update tickets set reservation_expires_at = now() - interval '1 minute'
       where id = any(${uuidArray(reservation.ticketIds)}::uuid[])
    `;

    await runExpireReservations();
    await runExpireReservations();

    expect(await availability(ticketTypeId)).toBe(3);
  });

  test('the sweep is scheduled every 60s and reconciliation every 5 min (§7.6)', () => {
    const expire = SCHEDULES.find((s) => s.id === 'expire-reservations');
    const reconcile = SCHEDULES.find((s) => s.id === 'reconcile-payments');

    expect(expire?.every).toBe(60_000);
    expect(reconcile?.every).toBe(300_000);
  });
});

// ================================================================ payments

describe('§6.3 POST /payments/order', () => {
  test('creates a pending payment linked to the reserved tickets', async () => {
    const userId = await makeUser('orderer');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
      quantity: 2,
    });

    expect(order.amount).toBe(1000);
    expect(order.razorpayOrderId).toMatch(/^order_test_/);

    const payment = await paymentRow(order.paymentId);
    expect(payment.status).toBe('pending');

    const tickets = await ticketRows(order.ticketIds);
    expect(tickets.every((t) => t.payment_id === order.paymentId)).toBe(true);
  });

  test('re-ordering the same tickets returns the existing order, not a second one', async () => {
    const userId = await makeUser('retrier');
    const first = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    const second = await paymentService.createPaymentOrder({
      userId,
      ticketIds: first.ticketIds,
    });

    expect(second.paymentId).toBe(first.paymentId);
    expect(second.razorpayOrderId).toBe(first.razorpayOrderId);

    const rows = (await sql`
      select count(*)::int as n from payments where user_id = ${userId}
    `) as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });

  test("ordering another user's tickets is FORBIDDEN", async () => {
    const owner = await makeUser('ticket-owner');
    const thief = await makeUser('ticket-thief');
    const order = await reserveAndOrder({
      userId: owner,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    await expect(
      paymentService.createPaymentOrder({ userId: thief, ticketIds: order.ticketIds }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('ordering against a lapsed reservation is RESERVATION_EXPIRED', async () => {
    const userId = await makeUser('too-slow');
    const reservation = await reservationService.createReservation({
      userId,
      eventId: farEvent,
      ticketDescriptionId: farTicketType,
      quantity: 1,
    });

    await sql`
      update tickets set reservation_status = 'expired'
       where id = any(${uuidArray(reservation.ticketIds)}::uuid[])
    `;

    await expect(
      paymentService.createPaymentOrder({ userId, ticketIds: reservation.ticketIds }),
    ).rejects.toMatchObject({ code: 'RESERVATION_EXPIRED' });
  });

  test('§8 — a fourth unpaid order is refused', async () => {
    const userId = await makeUser('order-spammer');

    for (let i = 0; i < 3; i++) {
      await reserveAndOrder({ userId, eventId: farEvent, ticketTypeId: farTicketType });
    }

    await expect(
      reserveAndOrder({ userId, eventId: farEvent, ticketTypeId: farTicketType }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('§7.2 confirmPayment', () => {
  test('confirms tickets, issues QR tokens, and queues one email', async () => {
    const userId = await makeUser('buyer');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
      quantity: 2,
    });

    const callback = clientCallback(order.razorpayOrderId);
    const result = await paymentService.confirmPayment({
      razorpayOrderId: callback.razorpay_order_id,
      razorpayPaymentId: callback.razorpay_payment_id,
      razorpaySignature: callback.razorpay_signature,
      source: 'client',
    });

    expect(result.alreadyProcessed).toBe(false);
    expect(result.status).toBe('captured');
    expect(result.tickets).toHaveLength(2);
    expect(result.tickets.every((t) => typeof t.qrToken === 'string')).toBe(true);

    const tickets = await ticketRows(order.ticketIds);
    expect(tickets.every((t) => t.reservation_status === 'confirmed')).toBe(true);
    expect(tickets.every((t) => t.qr_jwt_token !== null)).toBe(true);

    expect(await emailJobsFor(order.paymentId)).toHaveLength(1);
  });

  test('R3/F3 — calling twice yields one capture, one ticket set, one email', async () => {
    const userId = await makeUser('double-payer');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    const callback = clientCallback(order.razorpayOrderId);
    const input = {
      razorpayOrderId: callback.razorpay_order_id,
      razorpayPaymentId: callback.razorpay_payment_id,
      razorpaySignature: callback.razorpay_signature,
      source: 'client' as const,
    };

    const first = await paymentService.confirmPayment(input);
    const afterFirst = await ticketRows(order.ticketIds);

    const second = await paymentService.confirmPayment(input);
    const afterSecond = await ticketRows(order.ticketIds);

    expect(first.alreadyProcessed).toBe(false);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.tickets.map((t) => t.id)).toEqual(first.tickets.map((t) => t.id));

    // Not re-signed: the second call must not mint a new QR for the same seat.
    expect(afterSecond[0]!.qr_jwt_token).toBe(afterFirst[0]!.qr_jwt_token);

    const captures = (await sql`
      select count(*)::int as n from payments
       where razorpay_payment_id = ${callback.razorpay_payment_id} and status = 'captured'
    `) as Array<{ n: number }>;
    expect(captures[0]!.n).toBe(1);

    expect(await emailJobsFor(order.paymentId)).toHaveLength(1);
  });

  test('two simultaneous confirmations still produce one capture', async () => {
    const userId = await makeUser('racing-payer');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    const callback = clientCallback(order.razorpayOrderId);
    const input = {
      razorpayOrderId: callback.razorpay_order_id,
      razorpayPaymentId: callback.razorpay_payment_id,
      razorpaySignature: callback.razorpay_signature,
      source: 'client' as const,
    };

    const [a, b] = await Promise.all([
      paymentService.confirmPayment(input),
      paymentService.confirmPayment(input),
    ]);

    // The payments row lock serialises them; whichever loses the race takes the
    // idempotency gate.
    expect([a.alreadyProcessed, b.alreadyProcessed].sort()).toEqual([false, true]);
    expect(await emailJobsFor(order.paymentId)).toHaveLength(1);
  });

  test('a tampered signature is INVALID_SIGNATURE with zero database writes', async () => {
    const userId = await makeUser('forger');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    await expect(
      paymentService.confirmPayment({
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: 'pay_forged',
        razorpaySignature: 'deadbeef'.repeat(8),
        source: 'client',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });

    const payment = await paymentRow(order.paymentId);
    expect(payment.status).toBe('pending');
    expect(payment.razorpay_payment_id).toBeNull();
    expect(payment.razorpay_signature).toBeNull();

    const tickets = await ticketRows(order.ticketIds);
    expect(tickets.every((t) => t.reservation_status === 'reserved')).toBe(true);
    expect(tickets.every((t) => t.qr_jwt_token === null)).toBe(true);
  });

  test('paying after the reservation lapsed is RESERVATION_EXPIRED (F6)', async () => {
    const userId = await makeUser('late-payer');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    await sql`
      update tickets set reservation_status = 'expired'
       where id = any(${uuidArray(order.ticketIds)}::uuid[])
    `;

    const callback = clientCallback(order.razorpayOrderId);
    await expect(
      paymentService.confirmPayment({
        razorpayOrderId: callback.razorpay_order_id,
        razorpayPaymentId: callback.razorpay_payment_id,
        razorpaySignature: callback.razorpay_signature,
        source: 'client',
      }),
    ).rejects.toMatchObject({ code: 'RESERVATION_EXPIRED' });

    // Rolled back: the capture is not recorded, so reconciliation owns it now.
    expect((await paymentRow(order.paymentId)).status).toBe('pending');
  });

  test('an unknown order id is NOT_FOUND', async () => {
    const callback = clientCallback('order_does_not_exist');
    await expect(
      paymentService.confirmPayment({
        razorpayOrderId: callback.razorpay_order_id,
        razorpayPaymentId: callback.razorpay_payment_id,
        razorpaySignature: callback.razorpay_signature,
        source: 'client',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('R5 — the confirmation email is enqueued after the commit, never inside it', async () => {
    const userId = await makeUser('commit-order');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    // A separate pool connection reading at enqueue time can only see
    // 'captured' if the transaction has already committed. If the enqueue
    // happened inside the transaction, MVCC would still show 'pending'.
    let statusAtEnqueue: string | null = null;
    const originalAdd = emailQueue.add.bind(emailQueue);
    (emailQueue as unknown as { add: typeof originalAdd }).add = async (...args) => {
      const rows = (await sql`
        select status from payments where id = ${order.paymentId}
      `) as Array<{ status: string }>;
      statusAtEnqueue = rows[0]!.status;
      return originalAdd(...args);
    };

    try {
      const callback = clientCallback(order.razorpayOrderId);
      await paymentService.confirmPayment({
        razorpayOrderId: callback.razorpay_order_id,
        razorpayPaymentId: callback.razorpay_payment_id,
        razorpaySignature: callback.razorpay_signature,
        source: 'client',
      });
    } finally {
      (emailQueue as unknown as { add: typeof originalAdd }).add = originalAdd;
    }

    expect(statusAtEnqueue).toBe('captured');
  });
});

describe('§6.3 POST /payments/webhook', () => {
  test('an unsigned webhook is rejected before any database work', async () => {
    const userId = await makeUser('unsigned-webhook');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    const { body: raw } = webhookBody(order.razorpayOrderId, 'pay_unsigned');
    const { status, body } = await call('/payments/webhook', { method: 'POST', body: raw });

    expect(status).toBe(400);
    expect(body.error!.code).toBe('INVALID_SIGNATURE');
    expect((await paymentRow(order.paymentId)).status).toBe('pending');
  });

  test('a webhook with a wrong signature is rejected', async () => {
    const userId = await makeUser('bad-webhook');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    const { body: raw } = webhookBody(order.razorpayOrderId, 'pay_bad');
    const { status, body } = await call('/payments/webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': 'f'.repeat(64) },
      body: raw,
    });

    expect(status).toBe(400);
    expect(body.error!.code).toBe('INVALID_SIGNATURE');
    expect((await paymentRow(order.paymentId)).status).toBe('pending');
  });

  test('F3 — the same webhook delivered twice is a no-op the second time', async () => {
    const userId = await makeUser('twice-webhook');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    const paymentId = `pay_${crypto.randomUUID().slice(0, 12)}`;
    const { body: raw, signature } = webhookBody(order.razorpayOrderId, paymentId);
    const headers = { 'x-razorpay-signature': signature };

    const first = await call('/payments/webhook', { method: 'POST', headers, body: raw });
    const second = await call('/payments/webhook', { method: 'POST', headers, body: raw });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((first.body.data as { alreadyProcessed: boolean }).alreadyProcessed).toBe(false);
    expect((second.body.data as { alreadyProcessed: boolean }).alreadyProcessed).toBe(true);

    expect(await emailJobsFor(order.paymentId)).toHaveLength(1);

    const tickets = await ticketRows(order.ticketIds);
    expect(tickets.every((t) => t.reservation_status === 'confirmed')).toBe(true);
  });

  test('F4 — webhook first, then client verify, reaches the same final state', async () => {
    const userId = await makeUser('webhook-first');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    const rzpPaymentId = `pay_${crypto.randomUUID().slice(0, 12)}`;
    const { body: raw, signature } = webhookBody(order.razorpayOrderId, rzpPaymentId);

    await call('/payments/webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': signature },
      body: raw,
    });

    const afterWebhook = await ticketRows(order.ticketIds);

    const verify = await call('/payments/verify', {
      method: 'POST',
      headers: await auth(userId),
      body: JSON.stringify(clientCallback(order.razorpayOrderId, rzpPaymentId)),
    });

    expect(verify.status).toBe(200);
    const data = verify.body.data as { alreadyProcessed: boolean; tickets: Array<{ id: string }> };
    expect(data.alreadyProcessed).toBe(true);
    expect(data.tickets.map((t) => t.id).sort()).toEqual(order.ticketIds.slice().sort());

    // Byte-identical ticket state, and still exactly one email.
    expect(await ticketRows(order.ticketIds)).toEqual(afterWebhook);
    expect(await emailJobsFor(order.paymentId)).toHaveLength(1);

    const payment = await paymentRow(order.paymentId);
    expect(payment.status).toBe('captured');
    expect(payment.webhook_processed).toBe(true);
  });

  test('client verify first, then the webhook, records that the webhook arrived', async () => {
    const userId = await makeUser('client-first');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    const rzpPaymentId = `pay_${crypto.randomUUID().slice(0, 12)}`;

    const verify = await call('/payments/verify', {
      method: 'POST',
      headers: await auth(userId),
      body: JSON.stringify(clientCallback(order.razorpayOrderId, rzpPaymentId)),
    });
    expect(verify.status).toBe(200);
    expect((await paymentRow(order.paymentId)).webhook_processed).toBe(false);

    const { body: raw, signature } = webhookBody(order.razorpayOrderId, rzpPaymentId);
    await call('/payments/webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': signature },
      body: raw,
    });

    // Same end state as webhook-first (F4), which is the point.
    expect((await paymentRow(order.paymentId)).webhook_processed).toBe(true);
    expect(await emailJobsFor(order.paymentId)).toHaveLength(1);
  });

  test('a non-capture event is ignored without touching the payment', async () => {
    const userId = await makeUser('other-event');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    const raw = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: { id: 'pay_failed', order_id: order.razorpayOrderId, status: 'failed' },
        },
      },
    });
    const signature = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');

    const { status, body } = await call('/payments/webhook', {
      method: 'POST',
      headers: { 'x-razorpay-signature': signature },
      body: raw,
    });

    expect(status).toBe(200);
    expect((body.data as { ignored: string }).ignored).toBe('payment.failed');
    expect((await paymentRow(order.paymentId)).status).toBe('pending');
  });
});

// ========================================================== reconciliation

describe('§7.6 reconcilePayments', () => {
  test('F2 — a transaction that dies mid-confirmation leaves nothing half-done', async () => {
    const userId = await makeUser('crasher');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    // Stand in for the process dying between the payment update and the ticket
    // updates: the same place, with the same transactional consequence.
    await sql.unsafe(`
      create or replace function test_crash_on_confirm() returns trigger
      language plpgsql as $$
      begin
        if new.payment_id = '${order.paymentId}'::uuid
           and new.reservation_status = 'confirmed' then
          raise exception 'SIMULATED_CRASH';
        end if;
        return new;
      end $$;
    `);
    await sql`
      create trigger trg_test_crash before update on tickets
      for each row execute function test_crash_on_confirm()
    `;

    const rzpPaymentId = `pay_${crypto.randomUUID().slice(0, 12)}`;
    const callback = clientCallback(order.razorpayOrderId, rzpPaymentId);

    try {
      await expect(
        paymentService.confirmPayment({
          razorpayOrderId: callback.razorpay_order_id,
          razorpayPaymentId: callback.razorpay_payment_id,
          razorpaySignature: callback.razorpay_signature,
          source: 'client',
        }),
      ).rejects.toThrow();
    } finally {
      await sql`drop trigger trg_test_crash on tickets`;
    }

    const payment = await paymentRow(order.paymentId);
    expect(payment.status).toBe('pending');
    expect(payment.razorpay_payment_id).toBeNull();

    const tickets = await ticketRows(order.ticketIds);
    expect(tickets.every((t) => t.reservation_status === 'reserved')).toBe(true);
    expect(await emailJobsFor(order.paymentId)).toHaveLength(0);

    // Razorpay, meanwhile, took the money.
    upstream.set(order.razorpayOrderId, [
      { id: rzpPaymentId, status: 'captured', amount: 50_000, method: 'card' },
    ]);

    const report = await runReconcilePayments({ pendingOlderThanMinutes: 0 });
    expect(report.repaired).toBeGreaterThanOrEqual(1);

    const repaired = await paymentRow(order.paymentId);
    expect(repaired.status).toBe('captured');
    expect(repaired.razorpay_payment_id).toBe(rzpPaymentId);

    const fixed = await ticketRows(order.ticketIds);
    expect(fixed.every((t) => t.reservation_status === 'confirmed')).toBe(true);
    expect(fixed.every((t) => t.qr_jwt_token !== null)).toBe(true);
    expect(await emailJobsFor(order.paymentId)).toHaveLength(1);
  });

  test('F6 — a capture whose reservation lapsed is flagged, not confirmed', async () => {
    const userId = await makeUser('orphan');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    await sql`
      update tickets set reservation_status = 'expired'
       where id = any(${uuidArray(order.ticketIds)}::uuid[])
    `;

    const rzpPaymentId = `pay_${crypto.randomUUID().slice(0, 12)}`;
    upstream.set(order.razorpayOrderId, [
      { id: rzpPaymentId, status: 'captured', amount: 50_000, method: 'card' },
    ]);

    const report = await runReconcilePayments({ pendingOlderThanMinutes: 0 });
    expect(report.flaggedForRefund).toBeGreaterThanOrEqual(1);

    const payment = await paymentRow(order.paymentId);
    expect(payment.status).toBe('captured');
    expect(payment.failure_reason).toContain('orphaned_capture');
    expect(payment.razorpay_payment_id).toBe(rzpPaymentId);

    // Flagged rows are excluded from the orphan scan, so the next run does not
    // re-report the same money forever.
    const second = await runReconcilePayments({ pendingOlderThanMinutes: 0 });
    expect(second.flaggedForRefund).toBe(0);
  });

  test('a pending payment Razorpay never captured is left alone', async () => {
    const userId = await makeUser('abandoner');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    upstream.set(order.razorpayOrderId, []);

    await runReconcilePayments({ pendingOlderThanMinutes: 0 });

    expect((await paymentRow(order.paymentId)).status).toBe('pending');
  });
});

// ================================================================= tickets

describe('§6.3 tickets', () => {
  test('GET /tickets lists the caller’s own tickets, confirmed first', async () => {
    const userId = await makeUser('wallet');

    const confirmed = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });
    const callback = clientCallback(confirmed.razorpayOrderId);
    await paymentService.confirmPayment({
      razorpayOrderId: callback.razorpay_order_id,
      razorpayPaymentId: callback.razorpay_payment_id,
      razorpaySignature: callback.razorpay_signature,
      source: 'client',
    });

    await reservationService.createReservation({
      userId,
      eventId: farEvent,
      ticketDescriptionId: farTicketType,
      quantity: 1,
    });

    const { status, body } = await call('/tickets', { headers: await auth(userId) });
    expect(status).toBe(200);

    const items = body.data as Array<{ id: string; reservationStatus: string }>;
    expect(items).toHaveLength(2);
    expect(items[0]!.reservationStatus).toBe('confirmed');
    expect(items[1]!.reservationStatus).toBe('reserved');
  });

  test('GET /tickets/:id returns a QR token for a confirmed ticket', async () => {
    const userId = await makeUser('qr-holder');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });
    const callback = clientCallback(order.razorpayOrderId);
    await paymentService.confirmPayment({
      razorpayOrderId: callback.razorpay_order_id,
      razorpayPaymentId: callback.razorpay_payment_id,
      razorpaySignature: callback.razorpay_signature,
      source: 'client',
    });

    const { status, body } = await call(`/tickets/${order.ticketIds[0]}`, {
      headers: await auth(userId),
    });

    expect(status).toBe(200);
    const data = body.data as { qrToken: string; reservationStatus: string };
    expect(data.reservationStatus).toBe('confirmed');
    expect(data.qrToken.split('.')).toHaveLength(3);
  });

  test('a reserved-but-unpaid ticket has no QR token', async () => {
    const userId = await makeUser('unpaid-qr');
    const reservation = await reservationService.createReservation({
      userId,
      eventId: farEvent,
      ticketDescriptionId: farTicketType,
      quantity: 1,
    });

    const { body } = await call(`/tickets/${reservation.ticketIds[0]}`, {
      headers: await auth(userId),
    });
    expect((body.data as { qrToken: string | null }).qrToken).toBeNull();
  });

  test("another user's ticket is invisible, not merely forbidden", async () => {
    const owner = await makeUser('ticket-holder');
    const stranger = await makeUser('nosy');
    const reservation = await reservationService.createReservation({
      userId: owner,
      eventId: farEvent,
      ticketDescriptionId: farTicketType,
      quantity: 1,
    });

    const { status, body } = await call(`/tickets/${reservation.ticketIds[0]}`, {
      headers: await auth(stranger),
    });

    expect(status).toBe(404);
    expect(body.error!.code).toBe('NOT_FOUND');
  });

  test("§8 PII — an organizer cannot read a buyer's payment record", async () => {
    const userId = await makeUser('private-buyer');
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });

    // ORG1_USER organizes farEvent, so this is the strongest version of the
    // question: even the event's own organizer gets nothing.
    const { status, body } = await call(`/payments/${order.paymentId}`, {
      headers: await auth(ORG1_USER),
    });

    expect(status).toBe(404);
    expect(body.error!.code).toBe('NOT_FOUND');

    const owner = await call(`/payments/${order.paymentId}`, { headers: await auth(userId) });
    expect(owner.status).toBe(200);
  });
});

// ============================================================== QR scanning

describe('§7.4 POST /tickets/verify', () => {
  async function confirmedTicket(label: string) {
    const userId = await makeUser(label);
    const order = await reserveAndOrder({
      userId,
      eventId: farEvent,
      ticketTypeId: farTicketType,
    });
    const callback = clientCallback(order.razorpayOrderId);
    await paymentService.confirmPayment({
      razorpayOrderId: callback.razorpay_order_id,
      razorpayPaymentId: callback.razorpay_payment_id,
      razorpaySignature: callback.razorpay_signature,
      source: 'client',
    });

    const ticket = await ticketService.getTicket(order.ticketIds[0]!, {
      id: userId,
      role: 'attendee',
    });
    return { userId, ticketId: ticket.id, qrToken: ticket.qrToken! };
  }

  test('F7/F8 — the first scan admits, the second is TICKET_ALREADY_USED', async () => {
    const { qrToken, ticketId } = await confirmedTicket('scan-once');
    const headers = await auth(ORG1_USER);

    const first = await call('/tickets/verify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ qrToken }),
    });

    expect(first.status).toBe(200);
    const data = first.body.data as { attendeeName: string; verifiedAt: string };
    expect(data.attendeeName).toBe('scan-once');
    expect(new Date(data.verifiedAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    // A screenshot of the same QR, or a second door — same outcome.
    const second = await call('/tickets/verify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ qrToken }),
    });

    expect(second.status).toBe(409);
    expect(second.body.error!.code).toBe('TICKET_ALREADY_USED');

    const rows = (await sql`
      select status, verified_by from tickets where id = ${ticketId}
    `) as Array<{ status: string; verified_by: string }>;
    expect(rows[0]!.status).toBe('invalid');
    expect(rows[0]!.verified_by).toBe(ORG1_USER);
  });

  test('F7 — two doors scanning at the same instant: exactly one admits', async () => {
    const { qrToken } = await confirmedTicket('scan-race');

    const results = await Promise.all([
      ticketService
        .verifyTicketByQr({ qrToken, scannerUserId: ORG1_USER, scannerRole: 'organizer' })
        .then(() => 'ok')
        .catch((e: { code?: string }) => e.code),
      ticketService
        .verifyTicketByQr({ qrToken, scannerUserId: ORG1_USER, scannerRole: 'organizer' })
        .then(() => 'ok')
        .catch((e: { code?: string }) => e.code),
    ]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'TICKET_ALREADY_USED')).toHaveLength(1);
  });

  test("another organizer cannot scan this event's tickets", async () => {
    const { qrToken } = await confirmedTicket('scan-wrong-org');

    const { status, body } = await call('/tickets/verify', {
      method: 'POST',
      headers: await auth(ORG2_USER),
      body: JSON.stringify({ qrToken }),
    });

    expect(status).toBe(403);
    expect(body.error!.code).toBe('FORBIDDEN');
  });

  test('an admin can scan any event', async () => {
    const { qrToken } = await confirmedTicket('scan-by-admin');

    const { status } = await call('/tickets/verify', {
      method: 'POST',
      headers: await auth(ADMIN_USER),
      body: JSON.stringify({ qrToken }),
    });

    expect(status).toBe(200);
  });

  test('a QR signed with the auth secret is refused (R8)', async () => {
    const { ticketId } = await confirmedTicket('scan-wrong-secret');

    // JWT_SECRET, not QR_JWT_SECRET: exactly the confusion R8 exists to stop.
    const forged = await signAccessToken({
      userId: ticketId,
      role: 'attendee',
      status: 'active',
    });

    const { status, body } = await call('/tickets/verify', {
      method: 'POST',
      headers: await auth(ORG1_USER),
      body: JSON.stringify({ qrToken: forged }),
    });

    expect(status).toBe(401);
    expect(body.error!.code).toBe('UNAUTHENTICATED');
  });

  test('a rotated nonce retires every QR previously issued', async () => {
    const { qrToken, ticketId } = await confirmedTicket('scan-rotated');

    await sql`update tickets set qr_nonce = uuid_generate_v4() where id = ${ticketId}`;

    const { status, body } = await call('/tickets/verify', {
      method: 'POST',
      headers: await auth(ORG1_USER),
      body: JSON.stringify({ qrToken }),
    });

    expect(status).toBe(404);
    expect(body.error!.code).toBe('NOT_FOUND');
  });

  test('an unpaid ticket cannot be admitted', async () => {
    const userId = await makeUser('gatecrasher');
    const reservation = await reservationService.createReservation({
      userId,
      eventId: farEvent,
      ticketDescriptionId: farTicketType,
      quantity: 1,
    });

    // Mint a QR for a reserved ticket the way confirmation would.
    const rows = (await sql`
      select qr_nonce from tickets where id = ${reservation.ticketIds[0]}
    `) as Array<{ qr_nonce: string }>;
    const { signQrToken } = await import('../../apps/api/src/lib/jwt.ts');
    const qrToken = await signQrToken({
      ticketId: reservation.ticketIds[0]!,
      eventId: farEvent,
      nonce: rows[0]!.qr_nonce,
    });

    const { status, body } = await call('/tickets/verify', {
      method: 'POST',
      headers: await auth(ORG1_USER),
      body: JSON.stringify({ qrToken }),
    });

    expect(status).toBe(400);
    expect(body.error!.code).toBe('VALIDATION_FAILED');
  });
});

// ================================================================= refunds

describe('§7.5 refunds', () => {
  async function paidTicket(input: { label: string; eventId: string; ticketTypeId: string }) {
    const userId = await makeUser(input.label);
    const order = await reserveAndOrder({
      userId,
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
    });
    const callback = clientCallback(order.razorpayOrderId);
    await paymentService.confirmPayment({
      razorpayOrderId: callback.razorpay_order_id,
      razorpayPaymentId: callback.razorpay_payment_id,
      razorpaySignature: callback.razorpay_signature,
      source: 'client',
    });
    return { userId, ticketId: order.ticketIds[0]!, paymentId: order.paymentId };
  }

  test('inside the full-refund window returns 100% and restores the seat', async () => {
    const eventId = await makeEvent({ startsInHours: 24 * 10 });
    const ticketTypeId = await makeTicketType(eventId, 500, 10);
    const { userId, ticketId, paymentId } = await paidTicket({
      label: 'full-refund',
      eventId,
      ticketTypeId,
    });

    expect(await availability(ticketTypeId)).toBe(9);

    const { status, body } = await call(`/tickets/${ticketId}/refund`, {
      method: 'POST',
      headers: await auth(userId),
    });

    expect(status).toBe(200);
    const refund = body.data as { amount: number; status: string; razorpayRefundId: string };
    expect(refund.amount).toBe(500);
    expect(refund.status).toBe('processed');
    expect(refund.razorpayRefundId).toMatch(/^rfnd_test_/);

    expect(await availability(ticketTypeId)).toBe(10);
    expect((await paymentRow(paymentId)).status).toBe('refunded');

    const rows = await ticketRows([ticketId]);
    expect(rows[0]!.reservation_status).toBe('cancelled');
  });

  test('outside the full-refund window returns the partial percent', async () => {
    // 5h to go, against a 48h/50% policy.
    const eventId = await makeEvent({ startsInHours: 5 });
    const ticketTypeId = await makeTicketType(eventId, 500, 10);
    const { userId, ticketId } = await paidTicket({
      label: 'partial-refund',
      eventId,
      ticketTypeId,
    });

    const { status, body } = await call(`/tickets/${ticketId}/refund`, {
      method: 'POST',
      headers: await auth(userId),
    });

    expect(status).toBe(200);
    expect((body.data as { amount: number }).amount).toBe(250);
  });

  test('after the event has started the window is closed', async () => {
    const eventId = await makeEvent({ startsInHours: -1, durationHours: 4 });
    const ticketTypeId = await makeTicketType(eventId, 500, 10);
    const { userId, ticketId } = await paidTicket({
      label: 'too-late-refund',
      eventId,
      ticketTypeId,
    });

    const { status, body } = await call(`/tickets/${ticketId}/refund`, {
      method: 'POST',
      headers: await auth(userId),
    });

    expect(status).toBe(409);
    expect(body.error!.code).toBe('REFUND_WINDOW_CLOSED');

    // Nothing moved: the seat is still sold and the payment still captured.
    expect(await availability(ticketTypeId)).toBe(9);
    const rows = await ticketRows([ticketId]);
    expect(rows[0]!.reservation_status).toBe('confirmed');
  });

  test('refunding the same ticket twice is REFUND_ALREADY_ISSUED', async () => {
    const eventId = await makeEvent({ startsInHours: 24 * 10 });
    const ticketTypeId = await makeTicketType(eventId, 500, 10);
    const { userId, ticketId } = await paidTicket({
      label: 'double-refund',
      eventId,
      ticketTypeId,
    });

    const first = await call(`/tickets/${ticketId}/refund`, {
      method: 'POST',
      headers: await auth(userId),
    });
    expect(first.status).toBe(200);

    const second = await call(`/tickets/${ticketId}/refund`, {
      method: 'POST',
      headers: await auth(userId),
    });
    expect(second.status).toBe(409);
    expect(second.body.error!.code).toBe('REFUND_ALREADY_ISSUED');

    // One seat back, not two.
    expect(await availability(ticketTypeId)).toBe(10);

    const refunds = (await sql`
      select count(*)::int as n from refunds where ticket_id = ${ticketId}
    `) as Array<{ n: number }>;
    expect(refunds[0]!.n).toBe(1);
  });

  test("another user cannot refund someone else's ticket", async () => {
    const eventId = await makeEvent({ startsInHours: 24 * 10 });
    const ticketTypeId = await makeTicketType(eventId, 500, 10);
    const { ticketId } = await paidTicket({ label: 'not-yours', eventId, ticketTypeId });
    const stranger = await makeUser('refund-thief');

    const { status, body } = await call(`/tickets/${ticketId}/refund`, {
      method: 'POST',
      headers: await auth(stranger),
    });

    expect(status).toBe(404);
    expect(body.error!.code).toBe('NOT_FOUND');
  });

  test('a cancelled event refunds 100% regardless of the policy (F12)', async () => {
    // Starts in 5h, so the user-requested path would only return 50%.
    const eventId = await makeEvent({ startsInHours: 5 });
    const ticketTypeId = await makeTicketType(eventId, 500, 10);
    const a = await paidTicket({ label: 'cancelled-a', eventId, ticketTypeId });
    const b = await paidTicket({ label: 'cancelled-b', eventId, ticketTypeId });

    const report = await refundService.refundEventTickets({
      eventId,
      initiatedBy: ORG1_USER,
    });

    expect(report.attempted).toBe(2);
    expect(report.refunded).toBe(2);
    expect(report.failed).toBe(0);

    const amounts = (await sql`
      select amount from refunds where ticket_id = any(${uuidArray([a.ticketId, b.ticketId])}::uuid[])
    `) as Array<{ amount: string }>;
    expect(amounts.map((r) => Number(r.amount))).toEqual([500, 500]);

    expect(await availability(ticketTypeId)).toBe(10);
  });

  test('an unpaid reservation cannot be refunded', async () => {
    const eventId = await makeEvent({ startsInHours: 24 * 10 });
    const ticketTypeId = await makeTicketType(eventId, 500, 10);
    const userId = await makeUser('refund-unpaid');

    const reservation = await reservationService.createReservation({
      userId,
      eventId,
      ticketDescriptionId: ticketTypeId,
      quantity: 1,
    });

    const { status, body } = await call(`/tickets/${reservation.ticketIds[0]}/refund`, {
      method: 'POST',
      headers: await auth(userId),
    });

    expect(status).toBe(400);
    expect(body.error!.code).toBe('VALIDATION_FAILED');
  });

  test('the policy resolver is exact at the boundaries', () => {
    const policy = { full_refund_hours: 48, partial_refund_percent: 50 };
    const now = new Date('2026-01-01T00:00:00Z');
    const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

    expect(
      refundService.resolveRefundPercent({
        policy,
        startTime: at(48),
        reason: 'user_requested',
        now,
      }),
    ).toBe(100);

    expect(
      refundService.resolveRefundPercent({
        policy,
        startTime: at(47.9),
        reason: 'user_requested',
        now,
      }),
    ).toBe(50);

    expect(() =>
      refundService.resolveRefundPercent({
        policy,
        startTime: at(0),
        reason: 'user_requested',
        now,
      }),
    ).toThrow();

    // A cancelled event ignores the policy and the clock entirely.
    expect(
      refundService.resolveRefundPercent({
        policy,
        startTime: at(-100),
        reason: 'event_cancelled',
        now,
      }),
    ).toBe(100);
  });
});

// ================================================================= envelope

describe('R9 — payment routes use the envelope', () => {
  test('an unauthenticated order attempt is a well-formed 401', async () => {
    const { status, body } = await call('/payments/order', {
      method: 'POST',
      body: JSON.stringify({ ticketIds: [crypto.randomUUID()] }),
    });

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.error!.code).toBe('UNAUTHENTICATED');
    expect(body.meta?.requestId).toMatch(/^req_/);
  });

  test('a malformed reserve body is VALIDATION_FAILED', async () => {
    const userId = await makeUser('bad-body');
    const { status, body } = await call(`/events/${farEvent}/reserve`, {
      method: 'POST',
      headers: await auth(userId),
      body: JSON.stringify({ ticketDescriptionId: 'not-a-uuid', quantity: 0 }),
    });

    expect(status).toBe(400);
    expect(body.error!.code).toBe('VALIDATION_FAILED');
  });
});
