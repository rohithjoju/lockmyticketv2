import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import { getEnv } from '@event-ticketing/config';
import { AppError } from './errors.ts';
import { logger } from './logger.ts';

const env = getEnv();

const client = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

/** Razorpay works in paise; the database stores rupees as numeric(10,2). */
export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const toRupees = (paise: number): number => Math.round(paise) / 100;

/** Constant-time compare so a signature cannot be brute-forced byte by byte. */
function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Client callback signature: HMAC-SHA256 of `orderId|paymentId` keyed with
 * RAZORPAY_KEY_SECRET (§7.2 step 1). Verified before any database work — a
 * forged callback must not even cause a row lock.
 */
export function isValidPaymentSignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): boolean {
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest('hex');
  return safeEqualHex(expected, input.razorpaySignature);
}

/**
 * Webhook signature: HMAC-SHA256 over the **raw** body with
 * RAZORPAY_WEBHOOK_SECRET (§8). Re-serialising parsed JSON would change the
 * bytes and break the comparison, so callers must pass the body verbatim.
 */
export function isValidWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

/** Signs the way Razorpay does — used by tests and by nothing else. */
export function signPaymentPayload(orderId: string, paymentId: string): string {
  return createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

export type RazorpayOrder = { id: string; amount: number; currency: string; receipt?: string };

/** Wraps a third-party failure as UPSTREAM_UNAVAILABLE, never as a 500. */
async function callUpstream<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.error({ err: (err as Error)?.message, what }, 'razorpay call failed');
    throw new AppError('UPSTREAM_UNAVAILABLE', {
      message: 'The payment provider is currently unavailable. Please retry.',
      cause: err,
    });
  }
}

export function createOrder(input: {
  amountRupees: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  return callUpstream('orders.create', async () => {
    const order = await client.orders.create({
      amount: toPaise(input.amountRupees),
      currency: 'INR',
      receipt: input.receipt,
      notes: input.notes ?? {},
    });
    return order as unknown as RazorpayOrder;
  });
}

export type RazorpayPayment = { id: string; status: string; amount: number; method?: string };

/** Used by the reconciliation job to ask who is right about an order. */
export function fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]> {
  // If order id is a mock/synthetic seed, do not call Razorpay API.
  if (orderId.startsWith('order_seed_')) {
    return Promise.resolve([]);
  }

  return callUpstream('orders.fetchPayments', async () => {
    try {
      const res = (await client.orders.fetchPayments(orderId)) as unknown as {
        items?: RazorpayPayment[];
      };
      return res.items ?? [];
    } catch (err: unknown) {
      // If Razorpay returns a 400 (e.g. invalid order id format) or 404 (not found),
      // there are no captured payments upstream for this order.
      const errorObj = err as { statusCode?: number; error?: { code?: string } };
      if (
        errorObj?.statusCode === 400 ||
        errorObj?.statusCode === 404 ||
        errorObj?.error?.code === 'BAD_REQUEST_ERROR'
      ) {
        return [];
      }
      throw err;
    }
  });
}

export type RazorpayRefund = { id: string; status: string; amount: number };

export function createRefund(input: {
  razorpayPaymentId: string;
  amountRupees: number;
  notes?: Record<string, string>;
}): Promise<RazorpayRefund> {
  return callUpstream('payments.refund', async () => {
    const refund = await client.payments.refund(input.razorpayPaymentId, {
      amount: toPaise(input.amountRupees),
      notes: input.notes ?? {},
    });
    return refund as unknown as RazorpayRefund;
  });
}
