'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TicketDto } from '@event-ticketing/types';
import { LocalTime } from '@/components/LocalTime';
import { TicketQRModal } from '@/components/TicketQRModal';
import { TicketRefundModal } from '@/components/TicketRefundModal';
import { Badge, Button, ButtonLink, Notice } from '@/components/ui';
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

/** Epic 2.1/2.2 — ticket stub now opens QR or refund modals. */
function TicketStub({
  ticket,
  onQR,
  onRefund,
}: {
  ticket: TicketDto;
  onQR: () => void;
  onRefund: () => void;
}) {
  const { tone, label } = ticketTone(ticket);
  const canShowQR = ticket.reservationStatus === 'confirmed';
  const canRefund =
    ticket.reservationStatus === 'confirmed' && ticket.status === 'valid';

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

      <div className="stub-tear flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="truncate text-sm text-muted">{ticket.ticketType}</span>
          <span className="tabular text-sm font-semibold">{formatPrice(ticket.price)}</span>
        </div>

        {/* Action buttons — QR and refund land in Phase 7 */}
        <div className="mt-1 flex gap-2">
          {canShowQR && (
            <Button variant="quiet" className="h-8 flex-1 text-xs" onClick={onQR}>
              Show QR
            </Button>
          )}
          {canRefund && (
            <Button variant="ghost" className="h-8 flex-1 text-xs" onClick={onRefund}>
              Request refund
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [qrTicket, setQrTicket] = useState<TicketDto | null>(null);
  const [refundTicket, setRefundTicket] = useState<TicketDto | null>(null);

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
            <TicketStub
              key={ticket.id}
              ticket={ticket}
              onQR={() => setQrTicket(ticket)}
              onRefund={() => setRefundTicket(ticket)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {qrTicket && (
        <TicketQRModal ticket={qrTicket} onClose={() => setQrTicket(null)} />
      )}
      {refundTicket && (
        <TicketRefundModal ticket={refundTicket} onClose={() => setRefundTicket(null)} />
      )}
    </div>
  );
}
