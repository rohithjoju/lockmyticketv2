'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TicketDto } from '@event-ticketing/types';
import { apiClient } from '@/lib/apiClient';
import { LocalTime } from './LocalTime';
import { Badge, Button } from './ui';

/* QRCode.react is the package listed in SPEC §4.1 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { QRCodeSVG } = require('qrcode.react') as {
  QRCodeSVG: (props: { value: string; size: number; level: string }) => JSX.Element;
};

type FullTicketDto = TicketDto & { qrToken: string | null };

type Props = {
  ticket: TicketDto;
  onClose: () => void;
};

function admissionState(ticket: TicketDto) {
  if (ticket.reservationStatus === 'cancelled') return 'refunded';
  if (ticket.status === 'invalid') return 'checked_in';
  if (ticket.reservationStatus === 'confirmed') return 'ready';
  return 'invalid';
}

/**
 * Epic 2.1 — Cryptographic QR display modal.
 *
 * - Fetches full ticket including `qrToken` from GET /tickets/:id.
 * - Renders a dynamic QR (signed JWT, no PII, {tid, eid, nonce}).
 * - Shows a live UTC clock pulse below the QR to deter screenshots.
 * - Three visual states per admission state:
 *     ready      → green badge, prominent QR
 *     checked_in → muted badge, greyed-out QR with timestamp
 *     refunded   → red badge, no QR
 */
export function TicketQRModal({ ticket, onClose }: Props) {
  const [clock, setClock] = useState(() => new Date().toUTCString());

  useEffect(() => {
    const id = setInterval(() => setClock(new Date().toUTCString()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: fullTicket, isPending } = useQuery({
    queryKey: ['ticket', ticket.id],
    queryFn: async () => {
      const { data } = await apiClient.get<FullTicketDto>(`/tickets/${ticket.id}`);
      return data;
    },
    // Re-fetch every 30s so the displayed QR stays current
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const state = admissionState(ticket);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your ticket QR code"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="stub relative w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold leading-tight">{ticket.eventTitle}</h2>
            <p className="tabular mt-1 text-[11px] uppercase tracking-[0.12em] text-muted">
              <LocalTime iso={ticket.eventStartTime} />
            </p>
          </div>
          <Badge
            tone={
              state === 'ready' ? 'live' : state === 'checked_in' ? 'past' : 'off'
            }
          >
            {state === 'ready' ? 'Ready' : state === 'checked_in' ? 'Checked in' : 'Refunded'}
          </Badge>
        </div>

        {/* QR code section */}
        <div className="stub-tear -mx-5 px-5 pb-5 pt-6">
          {state === 'refunded' ? (
            <div className="grid place-items-center rounded-xl bg-danger/8 p-8">
              <p className="text-center text-sm font-medium text-danger">
                This ticket has been refunded
              </p>
            </div>
          ) : isPending ? (
            <div className="aspect-square w-full animate-pulse rounded-xl bg-sunk" />
          ) : fullTicket?.qrToken ? (
            <div
              className={`relative flex flex-col items-center gap-4 ${
                state === 'checked_in' ? 'opacity-40' : ''
              }`}
            >
              <div className="rounded-2xl bg-white p-4">
                <QRCodeSVG value={fullTicket.qrToken} size={200} level="H" />
              </div>

              {/* Anti-screenshot: live UTC clock pulse */}
              <p
                className="tabular select-none text-center text-[10px] font-medium uppercase tracking-[0.1em] text-muted"
                aria-hidden
              >
                {clock}
              </p>

              {state === 'checked_in' && ticket.verifiedAt && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-muted ring-1 ring-line">
                    Checked in <LocalTime iso={ticket.verifiedAt} />
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="grid place-items-center rounded-xl bg-sunk p-8">
              <p className="text-center text-sm text-muted">QR code unavailable</p>
            </div>
          )}

          <p className="mt-3 text-center text-xs text-muted">
            {ticket.ticketType} · {ticket.id.slice(0, 8).toUpperCase()}
          </p>
        </div>

        {/* Close */}
        <div className="px-5 pb-5 pt-3">
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
