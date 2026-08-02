import type { UserRole, UserStatus, VerificationStatus } from '@event-ticketing/types';
import { sql, withTransaction, type Tx } from '../db/transaction.ts';
import { AppError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import { decodeCursor, encodeCursor } from '../lib/cursor.ts';
import { recordAudit, type AuditContext } from './audit.service.ts';
import {
  ORGANIZER_COLUMNS,
  ORGANIZER_COLUMNS_ALIASED,
  toOrganizerDto,
  type OrganizerDto,
  type OrganizerRow,
} from './organizer.service.ts';
import type { Actor } from './event.service.ts';

/**
 * Admin capabilities (§6.3 /admin/*).
 *
 * Two rules shape every mutation in this file:
 *   R10 — the audit row is written inside the same transaction as the change,
 *         so the trail can never describe something that rolled back.
 *   F9  — organizer approval carries the caller's `version`; two admins acting
 *         on the same queue entry cannot both win.
 */

const iso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const isoOrNull = (value: string | Date | null): string | null =>
  value === null ? null : iso(value);

// ---------------------------------------------------------------- users

export type AdminUserDto = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lockedUntil: string | null;
  organizerId: string | null;
  organizerStatus: VerificationStatus | null;
  createdAt: string;
};

type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  locked_until: string | Date | null;
  organizer_id: string | null;
  organizer_status: VerificationStatus | null;
  created_at: string | Date;
};

function toAdminUserDto(row: AdminUserRow): AdminUserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    lockedUntil: isoOrNull(row.locked_until),
    organizerId: row.organizer_id,
    organizerStatus: row.organizer_status,
    createdAt: iso(row.created_at),
  };
}

/**
 * GET /admin/users. Newest first, keyset-paginated on (created_at, id).
 *
 * `q` matches name or email with a prefix-anchored ILIKE. Admin user search is
 * not the events full-text path — there is no `search_vector` on `users`, and
 * an anchored pattern still uses an index, unlike '%term%'.
 */
export async function listUsers(filters: {
  q?: string | undefined;
  role?: UserRole | undefined;
  status?: UserStatus | undefined;
  cursor?: string | undefined;
  limit: number;
}): Promise<{ items: AdminUserDto[]; nextCursor: string | null }> {
  const after = filters.cursor ? decodeCursor(filters.cursor) : null;
  const q = filters.q?.trim() ? `${filters.q.trim()}%` : null;

  const rows = (await sql`
    select u.id, u.name, u.email, u.role, u.status, u.locked_until, u.created_at,
           o.id as organizer_id, o.verification_status as organizer_status
      from users u
      left join organizers o on o.user_id = u.id
     where (${q}::text is null or u.name ilike ${q}::text or u.email ilike ${q}::text)
       and (${filters.role ?? null}::text is null or u.role = ${filters.role ?? null}::text)
       and (${filters.status ?? null}::text is null or u.status = ${filters.status ?? null}::text)
       and (${after?.sortValue ?? null}::timestamptz is null
            or (u.created_at, u.id) < (${after?.sortValue ?? null}::timestamptz,
                                       ${after?.id ?? null}::uuid))
     order by u.created_at desc, u.id desc
     limit ${filters.limit + 1}
  `) as AdminUserRow[];

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toAdminUserDto),
    nextCursor:
      hasMore && last ? encodeCursor({ id: last.id, sortValue: iso(last.created_at) }) : null,
  };
}

/**
 * PATCH /admin/users/:id/status (F10).
 *
 * Disabling an organizer must not punish their ticket holders: their events
 * stay publicly visible and every sold ticket stays valid. What changes is
 * that the account can no longer authenticate (middleware/auth.ts re-reads
 * `users.status` on every request, so a live access token stops working
 * immediately) and their live events are flagged for admin attention.
 *
 * Re-enabling does not clear `admin_flagged`: the flag is also set by media
 * moderation, and silently clearing it would erase an unrelated review item.
 */
export async function setUserStatus(
  targetUserId: string,
  status: UserStatus,
  actor: Actor,
  ctx: AuditContext = {},
): Promise<AdminUserDto> {
  if (targetUserId === actor.id) {
    throw new AppError('FORBIDDEN', {
      message: 'You cannot change your own account status.',
    });
  }

  return withTransaction(async (tx) => {
    const rows = (await tx`
      select id, status, role from users where id = ${targetUserId} for update
    `) as Array<{ id: string; status: UserStatus; role: UserRole }>;

    const existing = rows[0];
    if (!existing) throw new AppError('NOT_FOUND');

    await tx`update users set status = ${status} where id = ${targetUserId}`;

    let eventsFlagged = 0;
    if (status === 'disabled') {
      const flagged = (await tx`
        update events e
           set admin_flagged = true
          from organizers o
         where o.user_id = ${targetUserId}
           and e.organizer_id = o.id
           and e.cancelled_at is null
        returning e.id
      `) as Array<{ id: string }>;
      eventsFlagged = flagged.length;
    }

    // R10 — same transaction as the change it describes.
    await recordAudit(
      {
        actorUserId: actor.id,
        actionType: status === 'disabled' ? 'user.disabled' : 'user.enabled',
        targetTable: 'users',
        targetId: targetUserId,
        oldValue: { status: existing.status },
        newValue: { status, eventsFlagged },
      },
      ctx,
      tx,
    );

    if (eventsFlagged > 0) {
      logger.warn(
        { targetUserId, eventsFlagged },
        'disabled an organizer with live events; events flagged and left visible',
      );
    }

    const updated = (await tx`
      select u.id, u.name, u.email, u.role, u.status, u.locked_until, u.created_at,
             o.id as organizer_id, o.verification_status as organizer_status
        from users u
        left join organizers o on o.user_id = u.id
       where u.id = ${targetUserId}
    `) as AdminUserRow[];

    return toAdminUserDto(updated[0]!);
  });
}

// ----------------------------------------------------------- organizers

/**
 * GET /admin/organizers/pending — the approval queue, oldest first so the
 * longest-waiting applicant is dealt with first. Backed by
 * `idx_organizers_pending`.
 */
export async function listPendingOrganizers(filters: {
  cursor?: string | undefined;
  limit: number;
}): Promise<{ items: Array<OrganizerDto & { applicant: { id: string; name: string; email: string } }>; nextCursor: string | null }> {
  const after = filters.cursor ? decodeCursor(filters.cursor) : null;

  const rows = (await sql.unsafe(
    `
    select ${ORGANIZER_COLUMNS_ALIASED('o')},
           u.name as applicant_name, u.email as applicant_email
      from organizers o
      join users u on u.id = o.user_id
     where o.verification_status = 'pending'
       and ($1::timestamptz is null or (o.created_at, o.id) > ($1::timestamptz, $2::uuid))
     order by o.created_at asc, o.id asc
     limit $3
  `,
    [after?.sortValue ?? null, after?.id ?? null, filters.limit + 1],
  )) as Array<OrganizerRow & { applicant_name: string; applicant_email: string }>;

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => ({
      ...toOrganizerDto(row),
      applicant: { id: row.user_id, name: row.applicant_name, email: row.applicant_email },
    })),
    nextCursor:
      hasMore && last ? encodeCursor({ id: last.id, sortValue: iso(last.created_at) }) : null,
  };
}

/**
 * The optimistic lock (F9). The UPDATE matches on `version`, so of two admins
 * holding the same queue entry only the first writes; the second matches zero
 * rows and is told the record moved under them rather than silently
 * overwriting the other admin's decision.
 */
async function transitionOrganizer(
  tx: Tx,
  input: {
    organizerId: string;
    expectedVersion: number;
    status: VerificationStatus;
    rejectionReason: string | null;
  },
): Promise<{ before: OrganizerRow; after: OrganizerRow }> {
  const current = (await tx.unsafe(
    `select ${ORGANIZER_COLUMNS} from organizers where id = $1 for update`,
    [input.organizerId],
  )) as OrganizerRow[];

  const before = current[0];
  if (!before) throw new AppError('NOT_FOUND');

  if (before.version !== input.expectedVersion) {
    throw new AppError('VERSION_CONFLICT', {
      message:
        'This application was updated by someone else. Reload the queue and try again.',
      field: 'version',
    });
  }

  const updated = (await tx.unsafe(
    `
    update organizers set
      verification_status = $2,
      rejection_reason    = $3,
      version             = version + 1
    where id = $1 and version = $4
    returning ${ORGANIZER_COLUMNS}
  `,
    [input.organizerId, input.status, input.rejectionReason, input.expectedVersion],
  )) as OrganizerRow[];

  // Unreachable while the row lock above is held, but a zero-row UPDATE must
  // never be mistaken for success on a money-adjacent state machine.
  if (!updated[0]) throw new AppError('VERSION_CONFLICT');

  return { before, after: updated[0] };
}

/**
 * POST /admin/organizers/:id/approve.
 *
 * Approval is what grants the capability, so it also promotes the user's role.
 * An admin applying to be an organizer keeps their admin role — a demotion
 * here would lock them out of the very queue they are working.
 */
export async function approveOrganizer(
  organizerId: string,
  input: { version: number },
  actor: Actor,
  ctx: AuditContext = {},
): Promise<OrganizerDto> {
  return withTransaction(async (tx) => {
    const { before, after } = await transitionOrganizer(tx, {
      organizerId,
      expectedVersion: input.version,
      status: 'approved',
      rejectionReason: null,
    });

    await tx`
      update users set role = 'organizer'
       where id = ${after.user_id} and role = 'attendee'
    `;

    await recordAudit(
      {
        actorUserId: actor.id,
        actionType: 'organizer.approved',
        targetTable: 'organizers',
        targetId: organizerId,
        oldValue: {
          verificationStatus: before.verification_status,
          version: before.version,
        },
        newValue: { verificationStatus: 'approved', version: after.version },
      },
      ctx,
      tx,
    );

    return toOrganizerDto(after);
  });
}

/**
 * POST /admin/organizers/:id/reject.
 *
 * The user's role is left alone. `verification_status` is what every
 * organizer-only path checks, so a rejected applicant is already blocked;
 * demoting them as well would silently strip an organizer who was approved
 * earlier and is being re-reviewed.
 */
export async function rejectOrganizer(
  organizerId: string,
  input: { version: number; reason: string },
  actor: Actor,
  ctx: AuditContext = {},
): Promise<OrganizerDto> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'A rejection reason is required.',
      field: 'reason',
    });
  }

  return withTransaction(async (tx) => {
    const { before, after } = await transitionOrganizer(tx, {
      organizerId,
      expectedVersion: input.version,
      status: 'rejected',
      rejectionReason: reason,
    });

    await recordAudit(
      {
        actorUserId: actor.id,
        actionType: 'organizer.rejected',
        targetTable: 'organizers',
        targetId: organizerId,
        oldValue: {
          verificationStatus: before.verification_status,
          version: before.version,
        },
        newValue: { verificationStatus: 'rejected', version: after.version, reason },
      },
      ctx,
      tx,
    );

    return toOrganizerDto(after);
  });
}

// --------------------------------------------------------------- events

export type AdminEventDto = {
  id: string;
  title: string;
  city: string;
  startTime: string;
  endTime: string;
  status: string;
  adminFlagged: boolean;
  cancelledAt: string | null;
  organizerId: string;
  organizationName: string;
  ticketsSold: number;
  createdAt: string;
};

/** GET /admin/events — every event, any status, cancelled ones included. */
export async function listAllEvents(filters: {
  status?: string | undefined;
  flagged?: boolean | undefined;
  organizerId?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}): Promise<{ items: AdminEventDto[]; nextCursor: string | null }> {
  const after = filters.cursor ? decodeCursor(filters.cursor) : null;

  const rows = (await sql`
    select e.id, e.title, e.city, e.start_time, e.end_time, e.status,
           e.admin_flagged, e.cancelled_at, e.organizer_id, e.created_at,
           o.organization_name,
           (select count(*) from tickets t
             where t.event_id = e.id and t.reservation_status = 'confirmed')::int as tickets_sold
      from events_with_status e
      join organizers o on o.id = e.organizer_id
     where (${filters.status ?? null}::text is null or e.status = ${filters.status ?? null}::text)
       and (${filters.flagged ?? null}::boolean is null
            or e.admin_flagged = ${filters.flagged ?? null}::boolean)
       and (${filters.organizerId ?? null}::uuid is null
            or e.organizer_id = ${filters.organizerId ?? null}::uuid)
       and (${after?.sortValue ?? null}::timestamptz is null
            or (e.created_at, e.id) < (${after?.sortValue ?? null}::timestamptz,
                                       ${after?.id ?? null}::uuid))
     order by e.created_at desc, e.id desc
     limit ${filters.limit + 1}
  `) as Array<{
    id: string;
    title: string;
    city: string;
    start_time: string | Date;
    end_time: string | Date;
    status: string;
    admin_flagged: boolean;
    cancelled_at: string | Date | null;
    organizer_id: string;
    organization_name: string;
    tickets_sold: number;
    created_at: string | Date;
  }>;

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => ({
      id: row.id,
      title: row.title,
      city: row.city,
      startTime: iso(row.start_time),
      endTime: iso(row.end_time),
      status: row.status,
      adminFlagged: row.admin_flagged,
      cancelledAt: isoOrNull(row.cancelled_at),
      organizerId: row.organizer_id,
      organizationName: row.organization_name,
      ticketsSold: row.tickets_sold,
      createdAt: iso(row.created_at),
    })),
    nextCursor:
      hasMore && last ? encodeCursor({ id: last.id, sortValue: iso(last.created_at) }) : null,
  };
}

// ------------------------------------------------------------ dashboard

export type AdminDashboard = {
  users: { total: number; active: number; disabled: number; byRole: Record<UserRole, number> };
  organizers: { pending: number; approved: number; rejected: number };
  events: { total: number; upcoming: number; ongoing: number; past: number; cancelled: number; flagged: number };
  tickets: { confirmed: number; reserved: number; checkedIn: number };
  revenue: { captured: number; refunded: number; net: number };
  payments: { captured: number; failed: number; pending: number; successRate: number };
};

/**
 * GET /admin/dashboard. `successRate` is the §9 payment-success metric
 * (< 95% pages someone), expressed over settled payments only — a payment
 * still pending has not failed yet and must not drag the number down.
 */
export async function getDashboard(): Promise<AdminDashboard> {
  const [users] = (await sql`
    select count(*)::int as total,
           count(*) filter (where status = 'active')::int   as active,
           count(*) filter (where status = 'disabled')::int as disabled,
           count(*) filter (where role = 'attendee')::int   as attendees,
           count(*) filter (where role = 'organizer')::int  as organizers,
           count(*) filter (where role = 'admin')::int      as admins
      from users
  `) as Array<Record<string, number>>;

  const [organizers] = (await sql`
    select count(*) filter (where verification_status = 'pending')::int  as pending,
           count(*) filter (where verification_status = 'approved')::int as approved,
           count(*) filter (where verification_status = 'rejected')::int as rejected
      from organizers
  `) as Array<Record<string, number>>;

  const [events] = (await sql`
    select count(*)::int as total,
           count(*) filter (where status = 'upcoming')::int  as upcoming,
           count(*) filter (where status = 'ongoing')::int   as ongoing,
           count(*) filter (where status = 'past')::int      as past,
           count(*) filter (where status = 'cancelled')::int as cancelled,
           count(*) filter (where admin_flagged)::int        as flagged
      from events_with_status
  `) as Array<Record<string, number>>;

  const [tickets] = (await sql`
    select count(*) filter (where reservation_status = 'confirmed')::int as confirmed,
           count(*) filter (where reservation_status = 'reserved')::int  as reserved,
           count(*) filter (where reservation_status = 'confirmed'
                              and status = 'invalid')::int               as checked_in
      from tickets
  `) as Array<Record<string, number>>;

  const [payments] = (await sql`
    select count(*) filter (where status = 'captured')::int as captured,
           count(*) filter (where status = 'failed')::int   as failed,
           count(*) filter (where status = 'pending')::int  as pending,
           count(*) filter (where status = 'refunded')::int as refunded,
           coalesce(sum(amount) filter (where status = 'captured'), 0) as captured_amount,
           coalesce(sum(amount) filter (where status = 'refunded'), 0) as refunded_amount
      from payments
  `) as Array<Record<string, string | number>>;

  const captured = Number(payments?.captured ?? 0);
  const failed = Number(payments?.failed ?? 0);
  const refunded = Number(payments?.refunded ?? 0);
  const settled = captured + failed + refunded;
  const capturedAmount = Number(payments?.captured_amount ?? 0);
  const refundedAmount = Number(payments?.refunded_amount ?? 0);

  return {
    users: {
      total: users?.total ?? 0,
      active: users?.active ?? 0,
      disabled: users?.disabled ?? 0,
      byRole: {
        attendee: users?.attendees ?? 0,
        organizer: users?.organizers ?? 0,
        admin: users?.admins ?? 0,
      },
    },
    organizers: {
      pending: organizers?.pending ?? 0,
      approved: organizers?.approved ?? 0,
      rejected: organizers?.rejected ?? 0,
    },
    events: {
      total: events?.total ?? 0,
      upcoming: events?.upcoming ?? 0,
      ongoing: events?.ongoing ?? 0,
      past: events?.past ?? 0,
      cancelled: events?.cancelled ?? 0,
      flagged: events?.flagged ?? 0,
    },
    tickets: {
      confirmed: tickets?.confirmed ?? 0,
      reserved: tickets?.reserved ?? 0,
      checkedIn: tickets?.checked_in ?? 0,
    },
    revenue: {
      captured: capturedAmount,
      refunded: refundedAmount,
      net: Number((capturedAmount - refundedAmount).toFixed(2)),
    },
    payments: {
      captured,
      failed,
      pending: Number(payments?.pending ?? 0),
      successRate: settled === 0 ? 1 : Number(((captured + refunded) / settled).toFixed(4)),
    },
  };
}
