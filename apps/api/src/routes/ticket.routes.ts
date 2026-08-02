import { Elysia, t } from 'elysia';
import { toEnvelope } from '../lib/errors.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requestIdPlugin } from '../middleware/requestId.ts';
import * as reservationService from '../services/reservation.service.ts';
import * as ticketService from '../services/ticket.service.ts';

const uuidParam = t.Object({ id: t.String({ format: 'uuid' }) });

export const ticketRoutes = new Elysia({ prefix: '/tickets' })
  .use(requestIdPlugin)
  .use(requireAuth)

  .get(
    '',
    async ({ query, user, requestId }) => {
      const { items, nextCursor } = await ticketService.listMyTickets(user.id, {
        cursor: query.cursor,
        limit: query.limit ?? 20,
      });
      return toEnvelope(items, { requestId, cursor: nextCursor });
    },
    {
      query: t.Object({
        cursor: t.Optional(t.String({ maxLength: 512 })),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
      }),
    },
  )

  /**
   * Declared before `/:id` so the literal wins the match — `verify` is not a
   * ticket id, and a uuid-formatted param would reject it anyway.
   */
  .post(
    '/verify',
    async ({ body, user, requestId }) =>
      toEnvelope(
        await ticketService.verifyTicketByQr({
          qrToken: body.qrToken,
          scannerUserId: user.id,
          scannerRole: user.role,
        }),
        { requestId },
      ),
    { body: t.Object({ qrToken: t.String({ minLength: 1, maxLength: 4_096 }) }) },
  )

  .get(
    '/:id',
    async ({ params, user, requestId }) =>
      toEnvelope(await ticketService.getTicket(params.id, user), { requestId }),
    { params: uuidParam },
  );

/**
 * §6.3 DELETE /reservations/:id.
 *
 * There is no `reservations` table: a reservation is a ticket in `reserved`
 * (§5.1), so `:id` is the ticket id returned by POST /events/:id/reserve.
 */
export const reservationRoutes = new Elysia({ prefix: '/reservations' })
  .use(requestIdPlugin)
  .use(requireAuth)

  .delete(
    '/:id',
    async ({ params, user, requestId }) => {
      await reservationService.releaseReservation(params.id, user);
      return toEnvelope({ released: true }, { requestId });
    },
    { params: uuidParam },
  );
