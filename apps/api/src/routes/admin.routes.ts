import { Elysia, t } from 'elysia';
import { toEnvelope } from '../lib/errors.ts';
import { requireRole } from '../middleware/auth.ts';
import { requestIdPlugin } from '../middleware/requestId.ts';
import * as adminService from '../services/admin.service.ts';
import * as auditService from '../services/audit.service.ts';

const uuidParam = t.Object({ id: t.String({ format: 'uuid' }) });

const pageQuery = {
  cursor: t.Optional(t.String({ maxLength: 512 })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
};

/**
 * §6.3 /admin/*. `requireRole('admin')` is the middleware layer; the RLS
 * policies in 0003/0006 are the primary one (R4). Neither is trusted alone.
 *
 * Every mutating handler passes `{ requestId, clientIp }` through to the
 * service so the audit row it writes can be traced back to the request that
 * caused it (R10, §9).
 */
export const adminRoutes = new Elysia({ prefix: '/admin' })
  .use(requestIdPlugin)
  .use(requireRole('admin'))

  // ------------------------------------------------------------- users

  .get(
    '/users',
    async ({ query, requestId }) => {
      const { items, nextCursor } = await adminService.listUsers({
        q: query.q,
        role: query.role,
        status: query.status,
        cursor: query.cursor,
        limit: query.limit ?? 25,
      });
      return toEnvelope(items, { requestId, cursor: nextCursor });
    },
    {
      query: t.Object({
        q: t.Optional(t.String({ maxLength: 200 })),
        role: t.Optional(
          t.Union([t.Literal('attendee'), t.Literal('organizer'), t.Literal('admin')]),
        ),
        status: t.Optional(t.Union([t.Literal('active'), t.Literal('disabled')])),
        ...pageQuery,
      }),
    },
  )

  .patch(
    '/users/:id/status',
    async ({ params, body, user, requestId, clientIp }) =>
      toEnvelope(
        await adminService.setUserStatus(params.id, body.status, user, {
          requestId,
          ipAddress: clientIp,
        }),
        { requestId },
      ),
    {
      params: uuidParam,
      body: t.Object({
        status: t.Union([t.Literal('active'), t.Literal('disabled')]),
      }),
    },
  )

  // -------------------------------------------------------- organizers

  .get(
    '/organizers/pending',
    async ({ query, requestId }) => {
      const { items, nextCursor } = await adminService.listPendingOrganizers({
        cursor: query.cursor,
        limit: query.limit ?? 25,
      });
      return toEnvelope(items, { requestId, cursor: nextCursor });
    },
    { query: t.Object(pageQuery) },
  )

  .post(
    '/organizers/:id/approve',
    async ({ params, body, user, requestId, clientIp }) =>
      toEnvelope(
        await adminService.approveOrganizer(params.id, body, user, {
          requestId,
          ipAddress: clientIp,
        }),
        { requestId },
      ),
    {
      params: uuidParam,
      // F9 — the version the admin was looking at when they decided.
      body: t.Object({ version: t.Integer({ minimum: 1 }) }),
    },
  )

  .post(
    '/organizers/:id/reject',
    async ({ params, body, user, requestId, clientIp }) =>
      toEnvelope(
        await adminService.rejectOrganizer(params.id, body, user, {
          requestId,
          ipAddress: clientIp,
        }),
        { requestId },
      ),
    {
      params: uuidParam,
      body: t.Object({
        version: t.Integer({ minimum: 1 }),
        reason: t.String({ minLength: 3, maxLength: 500 }),
      }),
    },
  )

  // ------------------------------------------------------------ events

  .get(
    '/events',
    async ({ query, requestId }) => {
      const { items, nextCursor } = await adminService.listAllEvents({
        status: query.status,
        flagged: query.flagged,
        organizerId: query.organizerId,
        cursor: query.cursor,
        limit: query.limit ?? 25,
      });
      return toEnvelope(items, { requestId, cursor: nextCursor });
    },
    {
      query: t.Object({
        status: t.Optional(
          t.Union([
            t.Literal('upcoming'),
            t.Literal('ongoing'),
            t.Literal('past'),
            t.Literal('cancelled'),
          ]),
        ),
        flagged: t.Optional(t.Boolean()),
        organizerId: t.Optional(t.String({ format: 'uuid' })),
        ...pageQuery,
      }),
    },
  )

  // -------------------------------------------------------- audit logs

  .get(
    '/audit-logs',
    async ({ query, requestId }) => {
      const { items, nextCursor } = await auditService.listAuditLogs({
        actorUserId: query.actorUserId,
        targetTable: query.targetTable,
        targetId: query.targetId,
        cursor: query.cursor,
        limit: query.limit ?? 50,
      });
      return toEnvelope(items, { requestId, cursor: nextCursor });
    },
    {
      query: t.Object({
        actorUserId: t.Optional(t.String({ format: 'uuid' })),
        targetTable: t.Optional(t.String({ maxLength: 50 })),
        targetId: t.Optional(t.String({ format: 'uuid' })),
        ...pageQuery,
      }),
    },
  )

  .get('/dashboard', async ({ requestId }) =>
    toEnvelope(await adminService.getDashboard(), { requestId }),
  );
