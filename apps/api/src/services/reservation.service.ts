import { getEnv } from '@event-ticketing/config';
import { sql, withTransaction } from '../db/transaction.ts';
import { AppError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import type { Actor } from './event.service.ts';

const env = getEnv();

export type Reservation = {
  ticketIds: string[];
  expiresAt: Date;
};

/**
 * Maps the exceptions reserve_tickets() raises onto the error registry (§7.3).
 *
 * The function communicates by `raise exception '<CODE>'`, so the driver hands
 * us a message containing that code. Matching on the code — not on the whole
 * message — keeps this working if Postgres ever decorates the text.
 */
function mapReserveError(err: unknown): AppError {
  const message = (err as { message?: string })?.message ?? '';

  if (message.includes('TICKET_SOLD_OUT')) return new AppError('TICKET_SOLD_OUT');
  if (message.includes('TICKET_LIMIT_EXCEEDED')) return new AppError('TICKET_LIMIT_EXCEEDED');
  if (message.includes('TICKET_TYPE_NOT_FOUND')) return new AppError('NOT_FOUND');
  if (message.includes('INVALID_QUANTITY')) {
    return new AppError('VALIDATION_FAILED', {
      message: 'Quantity must be at least 1.',
      field: 'quantity',
    });
  }
  return new AppError('INTERNAL_ERROR', { cause: err, detail: message });
}

/**
 * Wraps the reserve_tickets() Postgres function (§5.3).
 *
 * There is deliberately no availability check in this file. R1 requires the
 * read of `available_tickets` and the decrement that follows to happen inside
 * one locked database transaction; the moment either half moves up here, two
 * concurrent buyers can both pass the check and oversell the event (F1).
 */
export async function createReservation(input: {
  userId: string;
  eventId: string;
  ticketDescriptionId: string;
  quantity: number;
}): Promise<Reservation> {
  // Linkage and saleability only — none of this reads inventory, so none of it
  // can drift from the decision reserve_tickets() makes under its lock.
  const rows = (await sql`
    select e.id as event_id, e.cancelled_at, e.end_time
      from ticket_descriptions td
      join events e on e.id = td.event_id
     where td.id = ${input.ticketDescriptionId}
  `) as Array<{ event_id: string; cancelled_at: string | Date | null; end_time: string | Date }>;

  const link = rows[0];
  if (!link || link.event_id !== input.eventId) throw new AppError('NOT_FOUND');
  if (link.cancelled_at) {
    throw new AppError('VALIDATION_FAILED', { message: 'This event has been cancelled.' });
  }
  if (new Date(link.end_time).getTime() <= Date.now()) {
    throw new AppError('VALIDATION_FAILED', { message: 'This event has already ended.' });
  }

  let reserved: Array<{ ticket_id: string; expires_at: string | Date }>;
  try {
    reserved = (await sql`
      select ticket_id, expires_at
        from reserve_tickets(
          ${input.userId}::uuid,
          ${input.ticketDescriptionId}::uuid,
          ${input.quantity}::integer,
          ${env.RESERVATION_TTL_MINUTES}::integer,
          ${env.MAX_TICKETS_PER_USER_PER_EVENT}::integer
        )
    `) as Array<{ ticket_id: string; expires_at: string | Date }>;
  } catch (err) {
    throw mapReserveError(err);
  }

  const first = reserved[0];
  if (!first) throw new AppError('TICKET_SOLD_OUT');

  return {
    ticketIds: reserved.map((r) => r.ticket_id),
    expiresAt: new Date(first.expires_at),
  };
}

/**
 * Release a reservation early (§6.3 DELETE /reservations/:id).
 *
 * There is no `reservations` table — a reservation *is* a ticket sitting in
 * `reserved` (§5.1), so `:id` is a ticket id. Only a ticket the caller owns and
 * has not yet paid for can be released; inventory goes back through
 * cancel_ticket() so the restore is locked the same way the decrement was (R1).
 */
export async function releaseReservation(ticketId: string, actor: Actor): Promise<void> {
  await withTransaction(async (tx) => {
    const rows = (await tx`
      select id, user_id, reservation_status
        from tickets
       where id = ${ticketId}
    `) as Array<{ id: string; user_id: string; reservation_status: string }>;

    const ticket = rows[0];
    if (!ticket) throw new AppError('NOT_FOUND');
    if (ticket.user_id !== actor.id && actor.role !== 'admin') throw new AppError('FORBIDDEN');

    if (ticket.reservation_status === 'confirmed') {
      throw new AppError('VALIDATION_FAILED', {
        message: 'This ticket is paid for. Request a refund instead.',
      });
    }
    if (ticket.reservation_status !== 'reserved') {
      // Already expired or cancelled: the seat is back, so this is a no-op
      // rather than an error. Releasing twice must not restore twice.
      return;
    }

    const released = (await tx`
      select cancel_ticket(${ticketId}::uuid, 'reserved') as n
    `) as Array<{ n: number }>;

    if ((released[0]?.n ?? 0) === 0) {
      // The expiry job got there first between our read and the lock.
      logger.info({ ticketId }, 'reservation already released by another writer');
    }
  });
}
