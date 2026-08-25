import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import type { EventDetailDto } from '@event-ticketing/types';
import { BookingCta } from '@/components/BookingCta';
import { LocalTime } from '@/components/LocalTime';
import { Badge, Notice } from '@/components/ui';
import { formatPrice } from '@/lib/datetime';
import { serverApiOrNull } from '@/lib/serverApi';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const result = await serverApiOrNull<EventDetailDto>(`/events/${id}`);
  return { title: result?.data.title ?? 'Event' };
}

function TicketRow({
  name,
  description,
  price,
  available,
}: {
  name: string;
  description: string | null;
  price: number;
  available: number;
}) {
  const soldOut = available === 0;

  return (
    <li className="flex items-start justify-between gap-4 border-b border-line py-4 last:border-0">
      <div className="min-w-0">
        <p className="font-medium">{name}</p>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        <p className="tabular mt-1 text-xs text-muted">
          {soldOut ? (
            <span className="text-danger">Sold out</span>
          ) : available <= 20 ? (
            <span className="text-danger">{available} left</span>
          ) : (
            `${available} available`
          )}
        </p>
      </div>
      <span className="tabular shrink-0 text-lg font-semibold">{formatPrice(price)}</span>
    </li>
  );
}

export default async function EventDetailPage({ params }: Params) {
  const { id } = await params;
  const result = await serverApiOrNull<EventDetailDto>(`/events/${id}`);
  if (!result) notFound();

  const event = result.data;
  // Read live on every request (Phase 3 AC7) — never a cached count.
  const totalAvailable = event.ticketTypes.reduce((sum, type) => sum + type.availableTickets, 0);
  const cheapest = event.ticketTypes.reduce<number | null>(
    (min, type) => (min === null || type.price < min ? type.price : min),
    null,
  );
  const onSale = event.status === 'upcoming' || event.status === 'ongoing';

  return (
    <article className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      {event.status === 'cancelled' ? (
        <div className="mb-8">
          <Notice
            title="This event was cancelled"
            detail="Ticket holders are refunded in full, automatically. Nothing to claim."
          />
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <div>
          <div className="stub stub-media relative aspect-[16/9] bg-sunk">
            {event.posterUrl ? (
              <Image
                src={event.posterUrl}
                alt=""
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 720px"
                className="object-cover"
              />
            ) : (
              <div className="grid h-full place-items-center">
                <span className="font-display text-7xl font-extrabold tracking-[-0.06em] text-line-strong">
                  {event.city}
                </span>
              </div>
            )}
          </div>

          <div className="mt-8">
            <div className="flex flex-wrap items-center gap-2">
              {event.eventType ? <Badge>{event.eventType}</Badge> : null}
              {event.status === 'ongoing' ? <Badge tone="live">On now</Badge> : null}
              {event.status === 'past' ? <Badge tone="past">Over</Badge> : null}
            </div>

            <h1 className="mt-3 text-[clamp(2rem,5vw,3.25rem)] leading-[0.98]">{event.title}</h1>

            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  When
                </dt>
                <dd className="mt-1">
                  <LocalTime iso={event.startTime} endIso={event.endTime} showZone />
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Where
                </dt>
                <dd className="mt-1">
                  {event.locationName ? <div>{event.locationName}</div> : null}
                  <div className="text-muted">
                    {event.address ? `${event.address}, ` : ''}
                    {event.city}
                  </div>
                </dd>
              </div>
            </dl>

            {event.description ? (
              /* Sanitised server-side with DOMPurify before storage (§8), so
                 what arrives here is already the safe subset. */
              <div
                className="prose-invert mt-8 space-y-4 leading-relaxed text-fg/90 [&_a]:text-accent [&_a]:underline [&_li]:ml-5 [&_li]:list-disc"
                dangerouslySetInnerHTML={{ __html: event.description }}
              />
            ) : null}

            {event.termsAndConditions ? (
              <details className="mt-10 border-t border-line pt-6">
                <summary className="cursor-pointer text-sm font-medium">
                  Terms for this event
                </summary>
                <p className="mt-3 whitespace-pre-line text-sm text-muted">
                  {event.termsAndConditions}
                </p>
              </details>
            ) : null}
          </div>
        </div>

        <aside className="lg:sticky lg:top-24">
          <div className="stub p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl">Tickets</h2>
              {cheapest !== null ? (
                <span className="tabular text-sm text-muted">from {formatPrice(cheapest)}</span>
              ) : null}
            </div>

            {event.ticketTypes.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                The organizer has not put tickets on sale yet.
              </p>
            ) : (
              <ul className="mt-3">
                {event.ticketTypes.map((type) => (
                  <TicketRow
                    key={type.id}
                    name={type.name}
                    description={type.description}
                    price={type.price}
                    available={type.availableTickets}
                  />
                ))}
              </ul>
            )}

            {onSale && event.ticketTypes.length > 0 ? (
              <div className="stub-tear -mx-5 mt-5 px-5 pt-6">
                <BookingCta eventId={event.id} soldOut={totalAvailable === 0} />
                <p className="mt-3 text-center text-xs text-muted">
                  Tickets are held for 10 minutes once you reserve.
                </p>
              </div>
            ) : null}
          </div>

          <p className="mt-6 px-1 text-xs leading-relaxed text-muted">
            Full refund up to {event.refundPolicy.full_refund_hours} hours before the start.
            After that, {event.refundPolicy.partial_refund_percent}% back until the event begins.
          </p>
        </aside>
      </div>
    </article>
  );
}
