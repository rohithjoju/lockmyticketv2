import { Elysia, t } from 'elysia';
import { toEnvelope } from '../lib/errors.ts';
import { requireAuth } from '../middleware/auth.ts';
import { enforceRateLimit } from '../middleware/rateLimit.ts';
import { requestIdPlugin } from '../middleware/requestId.ts';
import * as eventService from '../services/event.service.ts';
import * as reservationService from '../services/reservation.service.ts';

/** R12 — shared boundary schemas. Nothing unvalidated reaches a service. */
const uuidParam = t.Object({ id: t.String({ format: 'uuid' }) });

const refundPolicySchema = t.Object({
  full_refund_hours: t.Integer({ minimum: 0, maximum: 8760 }),
  partial_refund_percent: t.Integer({ minimum: 0, maximum: 100 }),
});

const eventFields = {
  title: t.String({ minLength: 3, maxLength: 200 }),
  description: t.Optional(t.String({ maxLength: 20_000 })),
  eventType: t.Optional(t.String({ maxLength: 50 })),
  locationName: t.Optional(t.String({ maxLength: 200 })),
  address: t.Optional(t.String({ maxLength: 500 })),
  city: t.String({ minLength: 1, maxLength: 100 }),
  latitude: t.Optional(t.Number({ minimum: -90, maximum: 90 })),
  longitude: t.Optional(t.Number({ minimum: -180, maximum: 180 })),
  startTime: t.String({ format: 'date-time' }),
  endTime: t.String({ format: 'date-time' }),
  termsAndConditions: t.Optional(t.String({ maxLength: 20_000 })),
  refundPolicy: t.Optional(refundPolicySchema),
};

const ticketTypeFields = {
  name: t.String({ minLength: 1, maxLength: 100 }),
  description: t.Optional(t.String({ maxLength: 2_000 })),
  price: t.Number({ minimum: 0, maximum: 10_000_000 }),
  totalTickets: t.Integer({ minimum: 1, maximum: 1_000_000 }),
};

// ------------------------------------------------------------- public

export const publicEventRoutes = new Elysia({ prefix: '/events' })
  .use(requestIdPlugin)
  .get(
    '',
    async ({ query, requestId }) => {
      const { items, nextCursor } = await eventService.listEvents({
        q: query.q,
        city: query.city,
        from: query.from,
        to: query.to,
        cursor: query.cursor,
        limit: query.limit ?? 20,
      });
      return toEnvelope(items, { requestId, cursor: nextCursor });
    },
    {
      query: t.Object({
        q: t.Optional(t.String({ maxLength: 200 })),
        city: t.Optional(t.String({ maxLength: 100 })),
        from: t.Optional(t.String({ format: 'date-time' })),
        to: t.Optional(t.String({ format: 'date-time' })),
        cursor: t.Optional(t.String({ maxLength: 512 })),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 50 })),
      }),
    },
  )
  .get(
    '/:id',
    async ({ params, requestId }) =>
      toEnvelope(await eventService.getEventDetail(params.id), { requestId }),
    { params: uuidParam },
  );

// ---------------------------------------------------------- protected

export const protectedEventRoutes = new Elysia({ prefix: '/events' })
  .use(requestIdPlugin)
  .use(requireAuth)

  .post(
    '',
    async ({ body, user, requestId, set }) => {
      const event = await eventService.createEvent(user, body);
      set.status = 201;
      return toEnvelope(event, { requestId });
    },
    { body: t.Object(eventFields) },
  )

  .patch(
    '/:id',
    async ({ params, body, user, requestId }) =>
      toEnvelope(await eventService.updateEvent(params.id, user, body), { requestId }),
    {
      params: uuidParam,
      body: t.Partial(
        t.Object({
          ...eventFields,
          // F11 — mandatory once tickets are sold; the service enforces that.
          changeReason: t.String({ minLength: 3, maxLength: 500 }),
        }),
      ),
    },
  )

  .delete(
    '/:id',
    async ({ params, user, requestId }) =>
      toEnvelope(await eventService.cancelEvent(params.id, user), { requestId }),
    { params: uuidParam },
  )

  .post(
    '/:id/media',
    async ({ params, body, user, requestId }) => {
      const files = Array.isArray(body.file) ? body.file : [body.file];
      return toEnvelope(await eventService.attachMedia(params.id, user, body.slot, files), {
        requestId,
      });
    },
    {
      params: uuidParam,
      // The declared content type is not trusted: lib/cloudinary.ts re-checks
      // the magic bytes before anything is uploaded (§8).
      body: t.Object({
        slot: t.Union([t.Literal('poster'), t.Literal('images'), t.Literal('video')]),
        file: t.Union([t.File(), t.Files()]),
      }),
      type: 'multipart/form-data',
    },
  )

  .get(
    '/:id/attendees',
    async ({ params, query, user, requestId }) => {
      const { items, nextCursor } = await eventService.listAttendees(
        params.id,
        user,
        query.limit ?? 50,
        query.cursor,
      );
      return toEnvelope(items, { requestId, cursor: nextCursor });
    },
    {
      params: uuidParam,
      query: t.Object({
        cursor: t.Optional(t.String({ maxLength: 512 })),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 200 })),
      }),
    },
  )

  .get(
    '/:id/analytics',
    async ({ params, user, requestId }) =>
      toEnvelope(await eventService.getAnalytics(params.id, user), { requestId }),
    { params: uuidParam },
  )

  .post(
    '/:id/ticket-types',
    async ({ params, body, user, requestId, set }) => {
      const created = await eventService.createTicketType(params.id, user, body);
      set.status = 201;
      return toEnvelope(created, { requestId });
    },
    { params: uuidParam, body: t.Object(ticketTypeFields) },
  )

  /**
   * §6.3 POST /events/:id/reserve. Calls reserve_tickets() through the service;
   * no availability logic exists on this side of the boundary (R1).
   */
  .post(
    '/:id/reserve',
    async ({ params, body, user, requestId, set }) => {
      // §8 — 20/min/user, keyed on the user rather than the IP: a ticket drop
      // puts thousands of legitimate buyers behind one mobile carrier NAT.
      await enforceRateLimit({ key: `reserve:${user.id}`, limit: 20, windowSeconds: 60 });

      const reservation = await reservationService.createReservation({
        userId: user.id,
        eventId: params.id,
        ticketDescriptionId: body.ticketDescriptionId,
        quantity: body.quantity,
      });

      set.status = 201;
      return toEnvelope(
        {
          ticketIds: reservation.ticketIds,
          expiresAt: reservation.expiresAt.toISOString(),
        },
        { requestId },
      );
    },
    {
      params: uuidParam,
      body: t.Object({
        ticketDescriptionId: t.String({ format: 'uuid' }),
        quantity: t.Integer({ minimum: 1, maximum: 20 }),
      }),
    },
  );

// -------------------------------------------------------- ticket types

export const ticketTypeRoutes = new Elysia({ prefix: '/ticket-types' })
  .use(requestIdPlugin)
  .use(requireAuth)

  .patch(
    '/:id',
    async ({ params, body, user, requestId }) =>
      toEnvelope(await eventService.updateTicketType(params.id, user, body), { requestId }),
    { params: uuidParam, body: t.Partial(t.Object(ticketTypeFields)) },
  )

  .delete(
    '/:id',
    async ({ params, user, requestId }) => {
      await eventService.deleteTicketType(params.id, user);
      return toEnvelope({ deleted: true }, { requestId });
    },
    { params: uuidParam },
  );
