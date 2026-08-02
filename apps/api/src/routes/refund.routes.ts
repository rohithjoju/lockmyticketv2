import { Elysia, t } from 'elysia';
import { toEnvelope } from '../lib/errors.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requestIdPlugin } from '../middleware/requestId.ts';
import * as refundService from '../services/refund.service.ts';

/**
 * §6.3 POST /tickets/:id/refund — user-initiated, applies the event's
 * refund_policy. Lives on the /tickets prefix alongside ticket.routes.ts;
 * Elysia merges instances that share a prefix.
 */
export const refundRoutes = new Elysia({ prefix: '/tickets' })
  .use(requestIdPlugin)
  .use(requireAuth)

  .post(
    '/:id/refund',
    async ({ params, user, requestId }) =>
      toEnvelope(await refundService.requestRefund(params.id, user), { requestId }),
    { params: t.Object({ id: t.String({ format: 'uuid' }) }) },
  );
