import { Elysia, t } from 'elysia';
import { AppError, toEnvelope } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import { isValidWebhookSignature, signPaymentPayload } from '../lib/razorpay.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requestIdPlugin } from '../middleware/requestId.ts';
import * as paymentService from '../services/payment.service.ts';

const uuidParam = t.Object({ id: t.String({ format: 'uuid' }) });

export const paymentRoutes = new Elysia({ prefix: '/payments' })
  .use(requestIdPlugin)
  .use(requireAuth)

  .post(
    '/order',
    async ({ body, user, requestId, set }) => {
      const order = await paymentService.createPaymentOrder({
        userId: user.id,
        ticketIds: body.ticketIds,
      });
      set.status = 201;
      return toEnvelope(order, { requestId });
    },
    {
      body: t.Object({
        ticketIds: t.Array(t.String({ format: 'uuid' }), { minItems: 1, maxItems: 20 }),
      }),
    },
  )

  /**
   * The client callback. A latency optimisation for the buyer's UI, not the
   * source of truth (§7.1) — the webhook is the authority, and both call the
   * same confirmPayment().
   */
  .post(
    '/verify',
    async ({ body, requestId }) =>
      toEnvelope(
        await paymentService.confirmPayment({
          razorpayOrderId: body.razorpay_order_id,
          razorpayPaymentId: body.razorpay_payment_id,
          razorpaySignature: body.razorpay_signature,
          source: 'client',
        }),
        { requestId },
      ),
    {
      // Razorpay's checkout handler hands these back in snake_case; taking them
      // verbatim keeps the client from having to re-shape a signed payload.
      body: t.Object({
        razorpay_order_id: t.String({ minLength: 1, maxLength: 100 }),
        razorpay_payment_id: t.String({ minLength: 1, maxLength: 100 }),
        razorpay_signature: t.String({ minLength: 1, maxLength: 255 }),
      }),
    },
  )

  .get(
    '/:id',
    async ({ params, user, requestId }) =>
      toEnvelope(await paymentService.getPaymentDetail(params.id, user), { requestId }),
    { params: uuidParam },
  );

type WebhookPayload = {
  event: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; status?: string; method?: string } };
  };
};

/**
 * Razorpay webhook (§6.3). Public, but authenticated by HMAC over the raw body
 * against RAZORPAY_WEBHOOK_SECRET (§8) — nothing touches the database until
 * that check passes.
 */
export const paymentWebhookRoutes = new Elysia({ prefix: '/payments' })
  .use(requestIdPlugin)

  .post(
    '/webhook',
    async ({ body, headers, requestId }) => {
      const raw = body;

      if (!isValidWebhookSignature(raw, headers['x-razorpay-signature'] ?? null)) {
        logger.warn({ requestId }, 'rejected razorpay webhook with an invalid signature');
        throw new AppError('INVALID_SIGNATURE');
      }

      // Parsed only after the signature holds. R12 still applies: the shape is
      // checked here rather than trusted, because Elysia cannot schema-validate
      // a body it was told to leave as text.
      let parsed: WebhookPayload;
      try {
        parsed = JSON.parse(raw) as WebhookPayload;
      } catch {
        throw new AppError('VALIDATION_FAILED', { message: 'Webhook body is not valid JSON.' });
      }

      const entity = parsed.payload?.payment?.entity;
      if (!entity?.id || !entity.order_id) {
        throw new AppError('VALIDATION_FAILED', {
          message: 'Webhook payload is missing payment.entity.',
        });
      }

      // Events other than a capture carry no ticket consequence.
      if (parsed.event !== 'payment.captured' && entity.status !== 'captured') {
        return toEnvelope({ ignored: parsed.event }, { requestId });
      }

      const result = await paymentService.confirmPayment({
        razorpayOrderId: entity.order_id,
        razorpayPaymentId: entity.id,
        // The webhook authenticates with its own secret, so there is no
        // `orderId|paymentId` signature on the wire. It is derived here from
        // RAZORPAY_KEY_SECRET, which keeps confirmPayment's contract (§7.2)
        // identical for both callers instead of adding a bypass to it.
        razorpaySignature: signPaymentPayload(entity.order_id, entity.id),
        source: 'webhook',
        paymentMethod: entity.method ?? null,
      });

      return toEnvelope(
        { paymentId: result.paymentId, alreadyProcessed: result.alreadyProcessed },
        { requestId },
      );
    },
    {
      // The HMAC covers the exact bytes Razorpay sent. Re-serialising parsed
      // JSON would change them and break every signature.
      parse: ({ request }) => request.text(),
      body: t.String({ maxLength: 200_000 }),
    },
  );
