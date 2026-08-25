import type {
  EventDto,
  EventStatus,
  RefundPolicy,
  TicketTypeDto,
  UserRole,
  VerificationStatus,
} from '@event-ticketing/types';
import { sql, withTransaction } from '../db/transaction.ts';
import { AppError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import { decodeCursor, encodeCursor } from '../lib/cursor.ts';
import { sanitizePlainText, sanitizeRichText } from '../lib/sanitize.ts';
import {
  IMAGE_TYPES,
  MAX_EVENT_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_TYPES,
  readAndValidate,
  uploadBuffer,
} from '../lib/cloudinary.ts';
import {
  emailQueue,
  enqueueBestEffort,
  enqueueRequired,
  jobIds,
  reconcileQueue,
} from '../queues/index.ts';
import { recordAudit } from './audit.service.ts';

export type Actor = { id: string; role: UserRole };

// ---------------------------------------------------------------- DTOs
// Declared in packages/types so the web app renders exactly what this
// returns; re-exported here because the rest of this file reads better
// referring to them unqualified.

export type { EventDto, TicketTypeDto };

/** Columns of events_with_status we ever expose. `search_vector` is internal. */
const EVENT_COLUMNS = `
  e.id, e.organizer_id, e.title, e.description, e.event_type, e.location_name,
  e.address, e.city, e.latitude, e.longitude, e.start_time, e.end_time,
  e.poster_url, e.video_url, e.images_urls, e.terms_and_conditions,
  e.refund_policy, e.organizer_status_snapshot, e.admin_flagged,
  e.cancelled_at, e.status, e.created_at, e.updated_at
`;

type EventRow = {
  id: string;
  organizer_id: string;
  title: string;
  description: string | null;
  event_type: string | null;
  location_name: string | null;
  address: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  start_time: string | Date;
  end_time: string | Date;
  poster_url: string | null;
  video_url: string | null;
  images_urls: string[];
  terms_and_conditions: string | null;
  refund_policy: RefundPolicy;
  organizer_status_snapshot: string | null;
  admin_flagged: boolean;
  cancelled_at: string | Date | null;
  status: EventStatus;
  created_at: string | Date;
  updated_at: string | Date;
};

/** R6 — always hand out UTC ISO-8601; local time is a render concern. */
const iso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const isoOrNull = (value: string | Date | null): string | null =>
  value === null ? null : iso(value);

function toEventDto(row: EventRow): EventDto {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    title: row.title,
    description: row.description,
    eventType: row.event_type,
    locationName: row.location_name,
    address: row.address,
    city: row.city,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    startTime: iso(row.start_time),
    endTime: iso(row.end_time),
    posterUrl: row.poster_url,
    videoUrl: row.video_url,
    imagesUrls: row.images_urls ?? [],
    termsAndConditions: row.terms_and_conditions,
    refundPolicy: row.refund_policy,
    organizerStatusSnapshot: row.organizer_status_snapshot,
    adminFlagged: row.admin_flagged,
    cancelledAt: isoOrNull(row.cancelled_at),
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

type TicketTypeRow = {
  id: string;
  event_id: string;
  ticket_type_name: string;
  ticket_description: string | null;
  price: string | number;
  total_tickets: number;
  available_tickets: number;
};

function toTicketTypeDto(row: TicketTypeRow): TicketTypeDto {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.ticket_type_name,
    description: row.ticket_description,
    // numeric(10,2) arrives as a string; the API contract is a number.
    price: Number(row.price),
    totalTickets: row.total_tickets,
    availableTickets: row.available_tickets,
  };
}

// ------------------------------------------------------- authorization

/**
 * Resolves the caller's organizer record and insists it is approved.
 *
 * `ORGANIZER_NOT_APPROVED` and `FORBIDDEN` are deliberately different: the
 * first is a waiting room, the second is a wall. A pending applicant should
 * be told to wait, not that they are forbidden.
 *
 * This is the middleware layer only — RLS (`events_owner_write`) enforces the
 * same rule independently in the database (R4).
 */
export async function requireApprovedOrganizer(actor: Actor): Promise<{ organizerId: string }> {
  const rows = (await sql`
    select id, verification_status from organizers where user_id = ${actor.id}
  `) as Array<{ id: string; verification_status: VerificationStatus }>;

  const organizer = rows[0];
  if (!organizer) {
    throw new AppError('FORBIDDEN', {
      message: 'You do not have an organizer account.',
    });
  }
  if (organizer.verification_status !== 'approved') {
    throw new AppError('ORGANIZER_NOT_APPROVED');
  }
  return { organizerId: organizer.id };
}

/** The organizer id for this user, or null. Admins have no organizer record. */
async function organizerIdFor(userId: string): Promise<string | null> {
  const rows = (await sql`select id from organizers where user_id = ${userId}`) as Array<{
    id: string;
  }>;
  return rows[0]?.id ?? null;
}

/**
 * Loads an event and asserts the actor may mutate it. Admins pass; everyone
 * else must own it. A non-existent event and someone else's event both raise
 * FORBIDDEN-or-NOT_FOUND deliberately: NOT_FOUND for a missing id, FORBIDDEN
 * for a real event that is not yours — the latter is already public via
 * GET /events/:id, so there is nothing to hide.
 */
async function loadOwnedEvent(eventId: string, actor: Actor): Promise<EventRow> {
  const rows = (await sql.unsafe(
    `select ${EVENT_COLUMNS} from events_with_status e where e.id = $1`,
    [eventId],
  )) as EventRow[];

  const event = rows[0];
  if (!event) throw new AppError('NOT_FOUND');
  if (actor.role === 'admin') return event;

  const organizerId = await organizerIdFor(actor.id);
  if (!organizerId || organizerId !== event.organizer_id) throw new AppError('FORBIDDEN');
  return event;
}

async function loadOwnedTicketType(
  ticketTypeId: string,
  actor: Actor,
): Promise<{ row: TicketTypeRow; event: EventRow }> {
  const rows = (await sql`
    select id, event_id, ticket_type_name, ticket_description,
           price, total_tickets, available_tickets
      from ticket_descriptions where id = ${ticketTypeId}
  `) as TicketTypeRow[];

  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND');
  return { row, event: await loadOwnedEvent(row.event_id, actor) };
}

// -------------------------------------------------------------- search

export type EventFilters = {
  q?: string | undefined;
  city?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  limit: number;
};

/**
 * Builds the events listing query.
 *
 * Exported so tests can EXPLAIN exactly what production runs (Phase 3 AC1) —
 * an EXPLAIN of a hand-written lookalike proves nothing.
 *
 * Text search goes through `search_vector` and the GIN index, never
 * `LIKE '%term%'`. `websearch_to_tsquery` is used rather than `to_tsquery`
 * because `to_tsquery('english', 'jazz night')` is a syntax error on
 * unescaped user input; both hit the same index.
 */
export function buildEventSearchQuery(filters: EventFilters): {
  text: string;
  params: unknown[];
} {
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const where = ['e.cancelled_at is null'];

  if (filters.q) {
    where.push(`e.search_vector @@ websearch_to_tsquery('english', ${bind(filters.q)})`);
  }
  if (filters.city) {
    where.push(`lower(e.city) = lower(${bind(filters.city)})`);
  }
  if (filters.from) {
    where.push(`e.start_time >= ${bind(filters.from)}::timestamptz`);
  }
  if (filters.to) {
    where.push(`e.start_time <= ${bind(filters.to)}::timestamptz`);
  }
  if (filters.cursor) {
    const cursor = decodeCursor(filters.cursor);
    // Keyset, not OFFSET (§6.1): (start_time, id) is a total order, so pages
    // neither duplicate nor skip rows when events are inserted mid-scan.
    where.push(
      `(e.start_time, e.id) > (${bind(cursor.sortValue)}::timestamptz, ${bind(cursor.id)}::uuid)`,
    );
  }

  const text = `
    select ${EVENT_COLUMNS}
      from events_with_status e
     where ${where.join('\n       and ')}
     order by e.start_time asc, e.id asc
     limit ${bind(filters.limit + 1)}
  `;

  return { text, params };
}

export async function listEvents(
  filters: EventFilters,
): Promise<{ items: EventDto[]; nextCursor: string | null }> {
  const { text, params } = buildEventSearchQuery(filters);
  const rows = (await sql.unsafe(text, params)) as EventRow[];

  // One extra row was requested purely to detect "there is more".
  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toEventDto),
    nextCursor:
      hasMore && last ? encodeCursor({ id: last.id, sortValue: iso(last.start_time) }) : null,
  };
}

/** Event detail with live ticket-type availability (AC7). */
export async function getEventDetail(
  eventId: string,
): Promise<EventDto & { ticketTypes: TicketTypeDto[] }> {
  const rows = (await sql.unsafe(
    `select ${EVENT_COLUMNS} from events_with_status e where e.id = $1`,
    [eventId],
  )) as EventRow[];

  const event = rows[0];
  if (!event) throw new AppError('NOT_FOUND');

  return { ...toEventDto(event), ticketTypes: await listTicketTypes(eventId) };
}

export async function listTicketTypes(eventId: string): Promise<TicketTypeDto[]> {
  const rows = (await sql`
    select id, event_id, ticket_type_name, ticket_description,
           price, total_tickets, available_tickets
      from ticket_descriptions
     where event_id = ${eventId}
     order by price asc, created_at asc
  `) as TicketTypeRow[];
  return rows.map(toTicketTypeDto);
}

// ---------------------------------------------------------------- CRUD

export type CreateEventInput = {
  title: string;
  description?: string | undefined;
  eventType?: string | undefined;
  locationName?: string | undefined;
  address?: string | undefined;
  city: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  startTime: string;
  endTime: string;
  termsAndConditions?: string | undefined;
  refundPolicy?: RefundPolicy | undefined;
};

const DEFAULT_REFUND_POLICY: RefundPolicy = {
  full_refund_hours: 48,
  partial_refund_percent: 50,
};

function assertTimeOrder(startTime: string, endTime: string): void {
  if (new Date(endTime) <= new Date(startTime)) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'End time must be after start time.',
      field: 'endTime',
    });
  }
}

export async function createEvent(actor: Actor, input: CreateEventInput): Promise<EventDto> {
  const { organizerId } = await requireApprovedOrganizer(actor);
  assertTimeOrder(input.startTime, input.endTime);

  const rows = (await sql`
    insert into events (
      organizer_id, title, description, event_type, location_name, address,
      city, latitude, longitude, start_time, end_time, terms_and_conditions,
      refund_policy, organizer_status_snapshot
    ) values (
      ${organizerId},
      ${sanitizePlainText(input.title)},
      ${input.description ? sanitizeRichText(input.description) : null},
      ${input.eventType ?? null},
      ${input.locationName ?? null},
      ${input.address ?? null},
      ${input.city.trim()},
      ${input.latitude ?? null},
      ${input.longitude ?? null},
      ${input.startTime},
      ${input.endTime},
      ${input.termsAndConditions ? sanitizeRichText(input.termsAndConditions) : null},
      ${input.refundPolicy ?? DEFAULT_REFUND_POLICY},
      -- Snapshot: an event created while approved stays legitimate even if the
      -- organizer is later suspended (F10).
      'approved'
    )
    returning id
  `) as Array<{ id: string }>;

  return getEventDetail(rows[0]!.id);
}

export type UpdateEventInput = Partial<CreateEventInput> & { changeReason?: string | undefined };

/** Confirmed-or-reserved ticket count — "has this event sold anything yet". */
async function soldTicketCount(eventId: string): Promise<number> {
  const rows = (await sql`
    select count(*)::int as n from tickets
     where event_id = ${eventId} and reservation_status in ('reserved','confirmed')
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/**
 * F11 — once tickets are sold, an edit is a promise being changed. It requires
 * a stated reason, is written to `audit_logs`, and notifies holders.
 */
export async function updateEvent(
  eventId: string,
  actor: Actor,
  patch: UpdateEventInput,
): Promise<EventDto> {
  const existing = await loadOwnedEvent(eventId, actor);
  const sold = await soldTicketCount(eventId);

  if (sold > 0 && !patch.changeReason?.trim()) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'This event has sold tickets. A changeReason is required.',
      field: 'changeReason',
    });
  }

  const startTime = patch.startTime ?? iso(existing.start_time);
  const endTime = patch.endTime ?? iso(existing.end_time);
  assertTimeOrder(startTime, endTime);

  const rows = (await sql`
    update events set
      title                = ${patch.title !== undefined ? sanitizePlainText(patch.title) : existing.title},
      description          = ${
        patch.description !== undefined
          ? patch.description
            ? sanitizeRichText(patch.description)
            : null
          : existing.description
      },
      event_type           = ${patch.eventType ?? existing.event_type},
      location_name        = ${patch.locationName ?? existing.location_name},
      address              = ${patch.address ?? existing.address},
      city                 = ${patch.city?.trim() ?? existing.city},
      latitude             = ${patch.latitude ?? existing.latitude},
      longitude            = ${patch.longitude ?? existing.longitude},
      start_time           = ${startTime},
      end_time             = ${endTime},
      terms_and_conditions = ${
        patch.termsAndConditions !== undefined
          ? sanitizeRichText(patch.termsAndConditions)
          : existing.terms_and_conditions
      },
      refund_policy        = ${patch.refundPolicy ?? existing.refund_policy}
    where id = ${eventId}
    returning id
  `) as Array<{ id: string }>;

  if (!rows[0]) throw new AppError('NOT_FOUND');

  if (sold > 0) {
    await recordAudit({
      actorUserId: actor.id,
      actionType: 'event.updated_after_sale',
      targetTable: 'events',
      targetId: eventId,
      oldValue: {
        title: existing.title,
        startTime: iso(existing.start_time),
        endTime: iso(existing.end_time),
        city: existing.city,
      },
      newValue: { title: patch.title, startTime, endTime, city: patch.city, changeReason: patch.changeReason },
    });
    // R5 — holders are notified from a worker, never awaited here.
    await enqueueBestEffort(emailQueue, 'event_changed', {
      type: 'event_changed',
      eventId,
      changeReason: patch.changeReason!.trim(),
    });
  }

  return getEventDetail(eventId);
}

/**
 * Soft-cancel (§6.3 DELETE /events/:id). The row is never deleted: ticket
 * holders, payments, and the audit trail all still reference it.
 */
export async function cancelEvent(eventId: string, actor: Actor): Promise<EventDto> {
  const existing = await loadOwnedEvent(eventId, actor);
  if (existing.cancelled_at) return toEventDto(existing);

  const sold = await soldTicketCount(eventId);

  await sql`update events set cancelled_at = now() where id = ${eventId}`;

  await recordAudit({
    actorUserId: actor.id,
    actionType: 'event.cancelled',
    targetTable: 'events',
    targetId: eventId,
    oldValue: { cancelledAt: null },
    newValue: { cancelledAt: new Date().toISOString(), ticketsAffected: sold },
  });

  if (sold > 0) {
    logger.warn({ eventId, sold }, 'cancelled event has sold tickets; refunds queued');

    // F12 — 500 refunds is not something to hold an HTTP connection open for,
    // and the money must still move if this request dies (R5). Required, not
    // best-effort: silently dropping this leaves buyers out of pocket.
    await enqueueRequired(
      reconcileQueue,
      'bulk_refund',
      { type: 'bulk_refund', eventId, initiatedBy: actor.id },
      { jobId: jobIds.bulkRefund(eventId) },
    );

    await enqueueBestEffort(
      emailQueue,
      'event_cancelled',
      { type: 'event_cancelled', eventId },
      { jobId: jobIds.eventCancelled(eventId) },
    );
  }

  return getEventDetail(eventId);
}

// -------------------------------------------------------- ticket types

export type TicketTypeInput = {
  name: string;
  description?: string | undefined;
  price: number;
  totalTickets: number;
};

export async function createTicketType(
  eventId: string,
  actor: Actor,
  input: TicketTypeInput,
): Promise<TicketTypeDto> {
  const event = await loadOwnedEvent(eventId, actor);
  if (event.cancelled_at) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Cannot add ticket types to a cancelled event.',
    });
  }

  const rows = (await sql`
    insert into ticket_descriptions (
      event_id, ticket_type_name, ticket_description, price,
      total_tickets, available_tickets
    ) values (
      ${eventId},
      ${sanitizePlainText(input.name)},
      ${input.description ? sanitizePlainText(input.description) : null},
      ${input.price},
      ${input.totalTickets},
      ${input.totalTickets}
    )
    returning id, event_id, ticket_type_name, ticket_description,
              price, total_tickets, available_tickets
  `) as TicketTypeRow[];

  return toTicketTypeDto(rows[0]!);
}

/**
 * Capacity change. R1: `available_tickets` is read under SELECT ... FOR UPDATE
 * inside a transaction, and the new availability is derived from that locked
 * read — never from a value the caller sent or the API read earlier.
 *
 * Capacity cannot drop below what is already held; the tickets exist.
 */
export async function updateTicketType(
  ticketTypeId: string,
  actor: Actor,
  input: Partial<TicketTypeInput>,
): Promise<TicketTypeDto> {
  await loadOwnedTicketType(ticketTypeId, actor);

  return withTransaction(async (tx) => {
    const locked = (await tx`
      select id, event_id, ticket_type_name, ticket_description,
             price, total_tickets, available_tickets
        from ticket_descriptions
       where id = ${ticketTypeId}
       for update
    `) as TicketTypeRow[];

    const row = locked[0];
    if (!row) throw new AppError('NOT_FOUND');

    const held = row.total_tickets - row.available_tickets;
    const newTotal = input.totalTickets ?? row.total_tickets;

    if (newTotal < held) {
      throw new AppError('VALIDATION_FAILED', {
        message: `Cannot reduce capacity below the ${held} ticket(s) already reserved or sold.`,
        field: 'totalTickets',
      });
    }

    const updated = (await tx`
      update ticket_descriptions set
        ticket_type_name  = ${input.name !== undefined ? sanitizePlainText(input.name) : row.ticket_type_name},
        ticket_description = ${
          input.description !== undefined
            ? input.description
              ? sanitizePlainText(input.description)
              : null
            : row.ticket_description
        },
        price             = ${input.price ?? row.price},
        total_tickets     = ${newTotal},
        available_tickets = ${newTotal - held}
      where id = ${ticketTypeId}
      returning id, event_id, ticket_type_name, ticket_description,
                price, total_tickets, available_tickets
    `) as TicketTypeRow[];

    return toTicketTypeDto(updated[0]!);
  });
}

/** Deletable only while nothing references it — the FK is `on delete restrict`. */
export async function deleteTicketType(ticketTypeId: string, actor: Actor): Promise<void> {
  await loadOwnedTicketType(ticketTypeId, actor);

  const rows = (await sql`
    select count(*)::int as n from tickets where ticket_description_id = ${ticketTypeId}
  `) as Array<{ n: number }>;

  if ((rows[0]?.n ?? 0) > 0) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'This ticket type has tickets against it and cannot be deleted.',
    });
  }

  await sql`delete from ticket_descriptions where id = ${ticketTypeId}`;
}

// --------------------------------------------------------------- media

export type MediaSlot = 'poster' | 'images' | 'video';

/**
 * Uploads event media to Cloudinary and records the URLs.
 *
 * F13 — the event already exists by the time this runs, so a Cloudinary
 * timeout costs only the media, never the event.
 */
export async function attachMedia(
  eventId: string,
  actor: Actor,
  slot: MediaSlot,
  files: File[],
): Promise<EventDto> {
  await loadOwnedEvent(eventId, actor);

  if (files.length === 0) {
    throw new AppError('VALIDATION_FAILED', { message: 'No file supplied.', field: 'file' });
  }
  if (slot !== 'images' && files.length > 1) {
    throw new AppError('VALIDATION_FAILED', {
      message: `The ${slot} slot accepts a single file.`,
      field: 'file',
    });
  }
  if (slot === 'images' && files.length > MAX_EVENT_IMAGES) {
    throw new AppError('VALIDATION_FAILED', {
      message: `At most ${MAX_EVENT_IMAGES} images are allowed.`,
      field: 'file',
    });
  }

  const isVideo = slot === 'video';
  const allowed = isVideo ? VIDEO_TYPES : IMAGE_TYPES;
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  // Validate every file before uploading any of them — a rejected third image
  // should not leave two orphaned assets in Cloudinary.
  const validated = [];
  for (const file of files) {
    validated.push(await readAndValidate(file, allowed, maxBytes, 'file'));
  }

  const uploads = [];
  for (const { bytes } of validated) {
    uploads.push(
      await uploadBuffer({
        bytes,
        folder: `events/${eventId}/${slot}`,
        resourceType: isVideo ? 'video' : 'image',
        moderate: !isVideo,
      }),
    );
  }

  // §8 — moderation failures are flagged for an admin, not silently published.
  const rejected = uploads.some((u) => u.moderationStatus === 'rejected');
  const urls = uploads.map((u) => u.url);

  if (slot === 'poster') {
    await sql`update events set poster_url = ${urls[0]!} where id = ${eventId}`;
  } else if (slot === 'video') {
    await sql`update events set video_url = ${urls[0]!} where id = ${eventId}`;
  } else {
    await sql`update events set images_urls = ${urls} where id = ${eventId}`;
  }

  if (rejected) {
    await sql`update events set admin_flagged = true where id = ${eventId}`;
    logger.warn({ eventId }, 'cloudinary moderation rejected media; event flagged');
  }

  return getEventDetail(eventId);
}

// ----------------------------------------------------- attendees & analytics

export type AttendeeDto = {
  ticketId: string;
  attendeeName: string;
  ticketType: string;
  status: string;
  verifiedAt: string | null;
};

/**
 * §8 PII — reads `event_attendee_summary`, which exposes attendee names only.
 * Organizers never see emails, phone numbers, or payment records.
 */
export async function listAttendees(
  eventId: string,
  actor: Actor,
  limit: number,
  cursor?: string,
): Promise<{ items: AttendeeDto[]; nextCursor: string | null }> {
  await loadOwnedEvent(eventId, actor);

  const after = cursor ? decodeCursor(cursor) : null;

  const rows = (await sql`
    select ticket_id, attendee_name, ticket_type_name, status, verified_at
      from event_attendee_summary
     where event_id = ${eventId}
       and (${after?.id ?? null}::uuid is null or ticket_id > ${after?.id ?? null}::uuid)
     order by ticket_id asc
     limit ${limit + 1}
  `) as Array<{
    ticket_id: string;
    attendee_name: string;
    ticket_type_name: string;
    status: string;
    verified_at: string | Date | null;
  }>;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((r) => ({
      ticketId: r.ticket_id,
      attendeeName: r.attendee_name,
      ticketType: r.ticket_type_name,
      status: r.status,
      verifiedAt: isoOrNull(r.verified_at),
    })),
    nextCursor: hasMore && last ? encodeCursor({ id: last.ticket_id, sortValue: last.ticket_id }) : null,
  };
}

export type EventAnalytics = {
  eventId: string;
  ticketsSold: number;
  ticketsReserved: number;
  revenue: number;
  checkedIn: number;
  checkInRate: number;
  byTicketType: Array<{ ticketTypeId: string; name: string; sold: number; revenue: number }>;
  byDate: Array<{ date: string; sold: number; revenue: number }>;
};

export async function getAnalytics(eventId: string, actor: Actor): Promise<EventAnalytics> {
  await loadOwnedEvent(eventId, actor);

  const [totals] = (await sql`
    select
      count(*) filter (where t.reservation_status = 'confirmed')::int as sold,
      count(*) filter (where t.reservation_status = 'reserved')::int  as reserved,
      count(*) filter (where t.reservation_status = 'confirmed'
                         and t.status = 'invalid')::int               as checked_in,
      coalesce(sum(td.price) filter (where t.reservation_status = 'confirmed'), 0) as revenue
    from tickets t
    join ticket_descriptions td on td.id = t.ticket_description_id
    where t.event_id = ${eventId}
  `) as Array<{ sold: number; reserved: number; checked_in: number; revenue: string | number }>;

  const byType = (await sql`
    select td.id, td.ticket_type_name,
           count(t.id) filter (where t.reservation_status = 'confirmed')::int as sold,
           coalesce(sum(td.price) filter (where t.reservation_status = 'confirmed'), 0) as revenue
      from ticket_descriptions td
      left join tickets t on t.ticket_description_id = td.id
     where td.event_id = ${eventId}
     group by td.id, td.ticket_type_name
     order by td.ticket_type_name
  `) as Array<{ id: string; ticket_type_name: string; sold: number; revenue: string | number }>;

  const byDate = (await sql`
    select (t.created_at at time zone 'UTC')::date::text as date,
           count(*)::int as sold,
           coalesce(sum(td.price), 0) as revenue
      from tickets t
      join ticket_descriptions td on td.id = t.ticket_description_id
     where t.event_id = ${eventId} and t.reservation_status = 'confirmed'
     group by 1
     order by 1
  `) as Array<{ date: string; sold: number; revenue: string | number }>;

  const sold = totals?.sold ?? 0;
  const checkedIn = totals?.checked_in ?? 0;

  return {
    eventId,
    ticketsSold: sold,
    ticketsReserved: totals?.reserved ?? 0,
    revenue: Number(totals?.revenue ?? 0),
    checkedIn,
    checkInRate: sold === 0 ? 0 : Number((checkedIn / sold).toFixed(4)),
    byTicketType: byType.map((r) => ({
      ticketTypeId: r.id,
      name: r.ticket_type_name,
      sold: r.sold,
      revenue: Number(r.revenue),
    })),
    byDate: byDate.map((r) => ({ date: r.date, sold: r.sold, revenue: Number(r.revenue) })),
  };
}

// (Audit writing now lives in audit.service.ts — see the import at the top.)
