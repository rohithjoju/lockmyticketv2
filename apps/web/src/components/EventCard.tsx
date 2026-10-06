import Image from 'next/image';
import Link from 'next/link';
import type { EventDto } from '@event-ticketing/types';
import { formatPrice } from '@/lib/datetime';
import { LocalTime } from './LocalTime';
import { Badge } from './ui';

export type EventCardData = EventDto & {
  /** Cheapest live ticket, when the listing carries ticket types. */
  fromPrice?: number | null;
  ticketsLeft?: number | null;
};

function statusBadge(event: EventDto) {
  if (event.status === 'cancelled') return <Badge tone="off">Cancelled</Badge>;
  if (event.status === 'ongoing') return <Badge tone="live">On now</Badge>;
  if (event.status === 'past') return <Badge tone="past">Over</Badge>;
  return null;
}

/**
 * The stub. A poster panel, a torn edge, and a counterfoil carrying the two
 * numbers that decide whether someone taps: what it costs and how many are
 * left. Everything else on the card is quiet so those two can be loud.
 */
export function EventCard({ event }: { event: EventCardData }) {
  const soldOut = event.ticketsLeft === 0;

  return (
    <article className="h-full">
      <Link
        href={`/events/${event.id}`}
        className="stub stub-interactive group flex h-full flex-col transition"
      >
        <div className="stub-media relative aspect-[16/10] bg-sunk">
          {event.posterUrl ? (
            <Image
              src={event.posterUrl}
              alt={`Poster for ${event.title}`}
              fill
              sizes="(max-width: 768px) 100vw, 380px"
              className="object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full place-items-center">
              <span className="font-display text-5xl font-extrabold tracking-[-0.06em] text-line-strong">
                {event.city}
              </span>
            </div>
          )}

          <div className="absolute left-3 top-3 flex gap-1.5">{statusBadge(event)}</div>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <p className="tabular text-[11px] uppercase tracking-[0.12em] text-muted">
            <LocalTime iso={event.startTime} />
          </p>
          <h3 className="text-lg leading-tight">{event.title}</h3>
          <p className="text-sm text-muted">
            {event.locationName ? `${event.locationName} · ` : ''}
            {event.city}
          </p>
        </div>

        <div className="stub-tear flex items-center justify-between px-4 py-3">
          <span className="tabular text-sm font-semibold">
            {event.fromPrice == null ? (
              <span className="text-muted">See tickets</span>
            ) : (
              <>
                <span className="text-muted">from </span>
                {formatPrice(event.fromPrice)}
              </>
            )}
          </span>

          {soldOut ? (
            <span className="inline-block -rotate-6 border border-danger/60 bg-danger/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-danger">
              Sold out
            </span>
          ) : event.ticketsLeft != null && event.ticketsLeft <= 20 ? (
            <span className="tabular inline-flex items-center gap-1.5 text-xs font-semibold text-danger">
              <span className="size-1.5 animate-pulse rounded-full bg-danger" aria-hidden />
              {event.ticketsLeft} left
            </span>
          ) : null}
        </div>
      </Link>
    </article>
  );
}
