'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TicketDto } from '@event-ticketing/types';
import { ApiClientError, apiClient } from '@/lib/apiClient';
import { formatPrice } from '@/lib/datetime';
import { Button, Notice } from './ui';

type RefundPolicy = {
  full_refund_hours: number;
  partial_refund_percent: number;
};

type EventInfoDto = {
  startTime: string;
  refundPolicy: RefundPolicy;
};

type RefundResult = {
  id: string;
  amount: number;
  status: string;
};

type Props = {
  ticket: TicketDto;
  onClose: () => void;
};

function calcRefundPercent(policy: RefundPolicy, startTimeIso: string): number | null {
  const now = Date.now();
  const start = new Date(startTimeIso).getTime();
  const hoursUntil = (start - now) / (1000 * 3600);
  if (hoursUntil <= 0) return null; // window closed
  if (hoursUntil >= policy.full_refund_hours) return 100;
  return policy.partial_refund_percent;
}

/**
 * Epic 2.2 — Ticket cancellation & refund request UI.
 *
 * Shows the expected refund amount (based on event refund_policy) and
 * calls POST /tickets/:id/refund on confirm.
 * Handles REFUND_WINDOW_CLOSED, REFUND_ALREADY_ISSUED, EVENT_CANCELLED.
 */
export function TicketRefundModal({ ticket, onClose }: Props) {
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);

  // Fetch event info to calculate refund amount
  const { data: eventInfo, isPending: loadingEvent } = useQuery({
    queryKey: ['event-refund-info', ticket.eventId],
    queryFn: async () => {
      const { data } = await apiClient.get<EventInfoDto>(`/events/${ticket.eventId}`);
      return data;
    },
  });

  const refundMutation = useMutation({
    mutationFn: async (): Promise<RefundResult> => {
      const { data } = await apiClient.post<RefundResult>(`/tickets/${ticket.id}/refund`);
      return data;
    },
    onSuccess: () => {
      // Invalidate tickets so the dashboard reflects the cancelled status
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket', ticket.id] });
    },
  });

  const refundPercent = eventInfo
    ? calcRefundPercent(eventInfo.refundPolicy, eventInfo.startTime)
    : null;

  const refundAmount =
    refundPercent !== null ? (ticket.price * refundPercent) / 100 : 0;

  const windowClosed = refundPercent === null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request a refund"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="stub w-full max-w-sm p-5">
        <h2 className="text-xl font-semibold">Request a refund</h2>
        <p className="mt-1 text-sm text-muted">
          {ticket.eventTitle} · {ticket.ticketType}
        </p>

        <div className="mt-5 space-y-4">
          {loadingEvent ? (
            <div className="h-16 animate-pulse rounded-xl bg-sunk" />
          ) : windowClosed ? (
            <Notice
              title="Refund window closed"
              detail="The event has already started. Refunds are no longer available."
            />
          ) : (
            <div className="rounded-xl border border-line bg-sunk p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted">Expected refund</span>
                <span className="font-semibold">
                  {formatPrice(refundAmount)}
                  {refundPercent !== 100 ? (
                    <span className="ml-1 text-xs text-muted">({refundPercent}%)</span>
                  ) : null}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {refundPercent === 100
                  ? 'Full refund — event starts far enough away.'
                  : `Partial refund — the event starts soon (under ${eventInfo?.refundPolicy.full_refund_hours}h).`}
              </p>
            </div>
          )}

          {refundMutation.isSuccess ? (
            <Notice
              tone="info"
              title="Refund requested"
              detail="Your refund is being processed and will reach your original payment method in 5–7 business days."
            />
          ) : null}

          {refundMutation.error && (
            <Notice
              title={
                refundMutation.error instanceof ApiClientError
                  ? refundMutation.error.title
                  : 'Refund failed'
              }
              detail={
                refundMutation.error instanceof ApiClientError
                  ? refundMutation.error.detail
                  : undefined
              }
            />
          )}

          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={onClose}>
              Cancel
            </Button>

            {!refundMutation.isSuccess && (
              <Button
                variant="danger"
                className="flex-1"
                disabled={windowClosed || refundMutation.isPending || loadingEvent}
                onClick={() => {
                  if (!confirmed) {
                    setConfirmed(true);
                    return;
                  }
                  void refundMutation.mutateAsync();
                }}
              >
                {refundMutation.isPending
                  ? 'Processing…'
                  : confirmed
                    ? 'Confirm refund'
                    : 'Request refund'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
