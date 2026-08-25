'use client';

import { useQuery } from '@tanstack/react-query';
import type { TicketDto } from '@event-ticketing/types';
import { LocalTime } from '@/components/LocalTime';
import { Badge, ButtonLink, Notice } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { formatPrice } from '@/lib/datetime';

function ticketTone(ticket: TicketDto) {
  if (ticket.reservationStatus === 'confirmed') {
    return ticket.status === 'invalid'
      ? { tone: 'past' as const, label: 'Checked in' }
      : { tone: 'live' as const, label: 'Ready' };
  }
  if (ticket.reservationStatus === 'reserved') return { tone: 'neutral' as const, label: 'On hold' };
  if (ticket.reservationStatus === 'cancelled') return { tone: 'off' as const, label: 'Refunded' };
  return { tone: 'past' as const, label: 'Expired' };
}

/** The QR view for a confirmed ticket lands in Phase 7; the stub is read-only for now. */
function TicketStub({ ticket }: { ticket: TicketDto }) {
  const { tone, label } = ticketTone(ticket);

  return (
    <div className="stub h-full">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-base leading-tight">{ticket.eventTitle}</h3>
          <p className="tabular mt-1 text-[11px] uppercase tracking-[0.12em] text-muted">
            <LocalTime iso={ticket.eventStartTime} />
          </p>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </div>

      <div className="stub-tear flex items-center justify-between px-4 py-3">
        <span className="truncate text-sm text-muted">{ticket.ticketType}</span>
        <span className="tabular text-sm font-semibold">{formatPrice(ticket.price)}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();

  const tickets = useQuery({
    queryKey: ['tickets'],
    queryFn: async () => (await apiClient.get<TicketDto[]>('/tickets', { query: { limit: 24 } })).data,
  });

  const pending = user?.organizer?.verificationStatus === 'pending';

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 md:py-14">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Signed in as {user?.email}
        </p>
        <h1 className="mt-2 text-4xl">Your tickets</h1>
      </header>

      {pending ? (
        <div className="mb-8">
          <Notice
            tone="info"
            title="Your organizer application is under review"
            detail="You can buy tickets meanwhile. We will email you when an admin has looked at it."
          />
        </div>
      ) : null}

      {tickets.isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((slot) => (
            <div key={slot} className="h-36 animate-pulse rounded-[--radius-stub] bg-sunk" />
          ))}
        </div>
      ) : tickets.isError ? (
        <Notice
          title={
            tickets.error instanceof ApiClientError
              ? tickets.error.title
              : 'We could not load your tickets'
          }
          detail={tickets.error instanceof ApiClientError ? tickets.error.detail : undefined}
          requestId={
            tickets.error instanceof ApiClientError ? tickets.error.requestId : undefined
          }
        />
      ) : tickets.data.length === 0 ? (
        <div className="stub px-6 py-16 text-center">
          <h2 className="text-2xl">No tickets yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-muted">
            Anything you reserve or buy shows up here, with its QR code, the moment payment
            clears.
          </p>
          <div className="mt-6 flex justify-center">
            <ButtonLink href="/events">Find something to go to</ButtonLink>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {tickets.data.map((ticket) => (
            <TicketStub key={ticket.id} ticket={ticket} />
          ))}
        </div>
      )}
    </div>
  );
}
