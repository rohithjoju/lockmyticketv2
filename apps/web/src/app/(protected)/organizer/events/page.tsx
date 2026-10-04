'use client';

import { useQuery } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { LocalTime } from '@/components/LocalTime';
import { Badge, ButtonLink, Notice } from '@/components/ui';
import { formatPrice } from '@/lib/datetime';

type OrganizerEventDto = {
  id: string;
  title: string;
  city: string;
  startTime: string;
  endTime: string;
  status: string;
  adminFlagged: boolean;
  cancelledAt: string | null;
  ticketsSold: number;
  totalCapacity: number;
  grossRevenue: number;
  checkInRate: number;
};

function statusTone(status: string) {
  if (status === 'ongoing') return 'live' as const;
  if (status === 'past' || status === 'cancelled') return 'past' as const;
  return 'neutral' as const;
}

/**
 * Epic 4.1 — Organizer events list.
 *
 * Queries GET /events?organizerId=me and shows cards with:
 *  - Status badge (upcoming / ongoing / past / cancelled)
 *  - Quick metrics: tickets sold, revenue, capacity %
 *  - Action links: Edit, Analytics, Door Scanner, Attendee Roster
 */
export default function OrganizerEventsPage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['organizer-events'],
    queryFn: async () => {
      const { data } = await apiClient.get<OrganizerEventDto[]>('/events', {
        query: { organizerId: 'me', limit: 50 },
      });
      return data;
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 md:py-14">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            Hosting
          </p>
          <h1 className="mt-2 text-4xl">Your events</h1>
        </div>
        <ButtonLink href="/organizer/events/create" className="shrink-0">
          + Create event
        </ButtonLink>
      </header>

      {isPending ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-[--radius-stub] bg-sunk" />
          ))}
        </div>
      ) : isError ? (
        <Notice
          title={error instanceof ApiClientError ? error.title : 'Could not load events'}
          detail={error instanceof ApiClientError ? error.detail : undefined}
        />
      ) : !data || data.length === 0 ? (
        <div className="stub px-6 py-16 text-center">
          <h2 className="text-2xl">No events yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-muted">
            Create your first event and start selling tickets.
          </p>
          <div className="mt-6 flex justify-center">
            <ButtonLink href="/organizer/events/create">Create event</ButtonLink>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {data.map((event) => (
            <div key={event.id} className="stub p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={statusTone(event.status)}>
                      {event.status}
                    </Badge>
                    {event.adminFlagged && (
                      <Badge tone="off">Flagged</Badge>
                    )}
                  </div>
                  <h2 className="mt-1.5 truncate text-lg font-semibold">{event.title}</h2>
                  <p className="mt-0.5 text-sm text-muted">
                    {event.city} · <LocalTime iso={event.startTime} />
                  </p>

                  {/* Quick metrics */}
                  <dl className="tabular mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <div className="flex gap-1.5">
                      <dt className="text-muted">Sold</dt>
                      <dd className="font-semibold">
                        {event.ticketsSold}
                        {event.totalCapacity > 0 && (
                          <span className="ml-1 font-normal text-muted">
                            / {event.totalCapacity}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted">Revenue</dt>
                      <dd className="font-semibold">{formatPrice(event.grossRevenue)}</dd>
                    </div>
                    {event.status !== 'upcoming' && (
                      <div className="flex gap-1.5">
                        <dt className="text-muted">Check-in</dt>
                        <dd className="font-semibold">{Math.round(event.checkInRate * 100)}%</dd>
                      </div>
                    )}
                  </dl>
                </div>

                {/* Action links */}
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <ButtonLink
                    href={`/organizer/events/${event.id}/edit`}
                    variant="ghost"
                    className="h-9 px-4 text-xs"
                  >
                    Edit
                  </ButtonLink>
                  <ButtonLink
                    href={`/organizer/events/${event.id}/analytics`}
                    variant="quiet"
                    className="h-9 px-4 text-xs"
                  >
                    Analytics
                  </ButtonLink>
                  <ButtonLink
                    href={`/organizer/events/${event.id}/attendees`}
                    variant="quiet"
                    className="h-9 px-4 text-xs"
                  >
                    Roster
                  </ButtonLink>
                  {event.status === 'ongoing' || event.status === 'upcoming' ? (
                    <ButtonLink
                      href={`/organizer/events/${event.id}/scan`}
                      variant="primary"
                      className="h-9 px-4 text-xs"
                    >
                      Door scanner
                    </ButtonLink>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
