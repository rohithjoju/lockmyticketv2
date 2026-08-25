import type { ReservationStatus, TicketDto, TicketStatus } from '@event-ticketing/types';
import { sql } from '../db/transaction.ts';
import { decodeCursor, encodeCursor } from '../lib/cursor.ts';
import { AppError } from '../lib/errors.ts';
import { signQrToken, verifyQrToken } from '../lib/jwt.ts';
import { logger } from '../lib/logger.ts';
import type { Actor } from './event.service.ts';

/** Declared in packages/types so the web wallet renders exactly this. */
export type { TicketDto };

type TicketRow = {
  id: string;
  user_id: string;
  event_id: string;
  event_title: string;
  event_start_time: string | Date;
  ticket_type_name: string;
  price: string | number;
  status: TicketStatus;
  reservation_status: ReservationStatus;
  reservation_expires_at: string | Date;
  qr_nonce: string;
  verified_at: string | Date | null;
  created_at: string | Date;
};

const iso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function toDto(row: TicketRow): TicketDto {
  return {
    id: row.id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    eventStartTime: iso(row.event_start_time),
    ticketType: row.ticket_type_name,
    price: Number(row.price),
    status: row.status,
    reservationStatus: row.reservation_status,
    reservationExpiresAt: iso(row.reservation_expires_at),
    verifiedAt: row.verified_at === null ? null : iso(row.verified_at),
    createdAt: iso(row.created_at),
  };
}

/**
 * The caller's own tickets, confirmed first (§6.3 GET /tickets).
 *
 * Ordering is (rank, created_at desc, id desc) so the keyset cursor stays a
 * total order — `rank` is encoded into the cursor alongside the timestamp.
 */
export async function listMyTickets(
  userId: string,
  page: { cursor?: string | undefined; limit: number },
): Promise<{ items: TicketDto[]; nextCursor: string | null }> {
  const after = page.cursor ? decodeCursor(page.cursor) : null;
  const [afterRank, afterCreated] = after ? after.sortValue.split('|') : [null, null];

  const rows = (await sql`
    select t.id, t.user_id, t.event_id, e.title as event_title,
           e.start_time as event_start_time, td.ticket_type_name, td.price,
           t.status, t.reservation_status, t.reservation_expires_at,
           t.qr_nonce, t.verified_at, t.created_at,
           case when t.reservation_status = 'confirmed' then 0 else 1 end as rank
      from tickets t
      join events e on e.id = t.event_id
      join ticket_descriptions td on td.id = t.ticket_description_id
     where t.user_id = ${userId}
       and (
         ${afterRank}::int is null
         or (case when t.reservation_status = 'confirmed' then 0 else 1 end,
             t.created_at, t.id)
            < (${afterRank}::int, ${afterCreated}::timestamptz, ${after?.id ?? null}::uuid)
       )
     order by rank asc, t.created_at desc, t.id desc
     limit ${page.limit + 1}
  `) as Array<TicketRow & { rank: number }>;

  const hasMore = rows.length > page.limit;
  const items = hasMore ? rows.slice(0, page.limit) : rows;
  const last = items[items.length - 1];

  return {
    items: items.map(toDto),
    nextCursor:
      hasMore && last
        ? encodeCursor({ id: last.id, sortValue: `${last.rank}|${iso(last.created_at)}` })
        : null,
  };
}

export type TicketWithQr = TicketDto & { qrToken: string | null };

/**
 * A single ticket plus its QR token (§6.3 GET /tickets/:id).
 *
 * The token is re-signed on read rather than served from `tickets.qr_jwt_token`.
 * QR_TOKEN_TTL is 24h (§8) but a ticket is typically confirmed weeks before the
 * doors open, so the token stored at confirmation would be long expired by the
 * time it is scanned. The nonce is the stable secret; the JWT around it is
 * deliberately short-lived and refetched.
 */
export async function getTicket(ticketId: string, actor: Actor): Promise<TicketWithQr> {
  const rows = (await sql`
    select t.id, t.user_id, t.event_id, e.title as event_title,
           e.start_time as event_start_time, td.ticket_type_name, td.price,
           t.status, t.reservation_status, t.reservation_expires_at,
           t.qr_nonce, t.verified_at, t.created_at
      from tickets t
      join events e on e.id = t.event_id
      join ticket_descriptions td on td.id = t.ticket_description_id
     where t.id = ${ticketId}
  `) as TicketRow[];

  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND');
  // Someone else's ticket is not "forbidden", it is invisible — matching what
  // the RLS policy does on the same row (R4).
  if (row.user_id !== actor.id && actor.role !== 'admin') throw new AppError('NOT_FOUND');

  const qrToken =
    row.reservation_status === 'confirmed'
      ? await signQrToken({ ticketId: row.id, eventId: row.event_id, nonce: row.qr_nonce })
      : null;

  return { ...toDto(row), qrToken };
}

// -------------------------------------------------------------- door scanning

export type VerificationResult = {
  ticketId: string;
  attendeeName: string;
  ticketType: string;
  verifiedAt: string;
};

/**
 * Redeem a QR code at the door (§7.4).
 *
 * The state change is delegated entirely to verify_ticket_atomic(), whose
 * UPDATE ... WHERE status = 'valid' is what makes a shared screenshot or two
 * doors scanning at once safe (F7, F8). Zero returned rows means the ticket was
 * already redeemed — surfaced as TICKET_ALREADY_USED, never retried, never
 * turned into a read-then-write.
 */
export async function verifyTicketByQr(input: {
  qrToken: string;
  scannerUserId: string;
  scannerRole: Actor['role'];
}): Promise<VerificationResult> {
  const claims = await verifyQrToken(input.qrToken);

  const rows = (await sql`
    select t.id, t.event_id, t.qr_nonce, t.reservation_status, t.status,
           td.ticket_type_name, e.organizer_id, o.user_id as organizer_user_id
      from tickets t
      join events e on e.id = t.event_id
      join organizers o on o.id = e.organizer_id
      join ticket_descriptions td on td.id = t.ticket_description_id
     where t.id = ${claims.tid}
  `) as Array<{
    id: string;
    event_id: string;
    qr_nonce: string;
    reservation_status: ReservationStatus;
    status: TicketStatus;
    ticket_type_name: string;
    organizer_user_id: string;
  }>;

  const ticket = rows[0];
  if (!ticket) throw new AppError('NOT_FOUND');

  // A token whose claims disagree with the row was minted for something else.
  // The nonce check also retires every QR ever issued if a nonce is rotated.
  if (ticket.event_id !== claims.eid || ticket.qr_nonce !== claims.nonce) {
    logger.warn({ ticketId: ticket.id }, 'QR token claims do not match the ticket');
    throw new AppError('NOT_FOUND', { message: 'This QR code is no longer valid.' });
  }

  // Middleware layer of authorization; RLS enforces the same ownership
  // independently on the tickets table (R4).
  if (input.scannerRole !== 'admin' && ticket.organizer_user_id !== input.scannerUserId) {
    throw new AppError('FORBIDDEN', { message: 'You cannot scan tickets for this event.' });
  }

  if (ticket.reservation_status !== 'confirmed') {
    // Reserved, expired or refunded — never admitted, and distinct from a
    // ticket that was legitimately used.
    throw new AppError('VALIDATION_FAILED', {
      message: 'This ticket is not confirmed and cannot be admitted.',
    });
  }

  const redeemed = (await sql`
    select ticket_id, attendee_name, verified_at
      from verify_ticket_atomic(
        ${ticket.id}::uuid, ${ticket.event_id}::uuid, ${input.scannerUserId}::uuid
      )
  `) as Array<{ ticket_id: string; attendee_name: string; verified_at: string | Date }>;

  const result = redeemed[0];
  if (!result) throw new AppError('TICKET_ALREADY_USED');

  return {
    ticketId: result.ticket_id,
    attendeeName: result.attendee_name,
    ticketType: ticket.ticket_type_name,
    verifiedAt: iso(result.verified_at),
  };
}
