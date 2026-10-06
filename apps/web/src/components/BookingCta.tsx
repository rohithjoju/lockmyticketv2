'use client';

import { useState } from 'react';
import type { TicketTypeDto } from '@event-ticketing/types';
import { useAuth } from '@/hooks/useAuth';
import { useReservation } from '@/hooks/useReservation';
import { usePayment } from '@/hooks/usePayment';
import { ApiClientError } from '@/lib/apiClient';
import { formatPrice } from '@/lib/datetime';
import { ReservationTimer } from './ReservationTimer';
import { Button, ButtonLink, Notice } from './ui';

type Props = {
  eventId: string;
  soldOut: boolean;
  ticketTypes: TicketTypeDto[];
};

type BookingState =
  | { phase: 'idle' }
  | { phase: 'reserved'; ticketIds: string[]; expiresAt: string; selectedType: TicketTypeDto; quantity: number }
  | { phase: 'paying'; ticketIds: string[]; expiresAt: string; selectedType: TicketTypeDto; quantity: number }
  | { phase: 'expired' };

/**
 * Epic 1.4 — Interactive booking CTA (replaces the Phase 6 stub).
 *
 * Flow:
 *  1. User picks a ticket type and quantity (1–10, capped by availableTickets).
 *  2. "Reserve tickets" calls POST /events/:id/reserve → starts 10-min timer.
 *  3. Timer + payment button shown. Payment opens Razorpay modal.
 *  4. Modal dismissed → timer keeps running (user can retry before expiry).
 *  5. On expiry → releaseReservation for each ticketId → back to idle.
 */
export function BookingCta({ eventId, soldOut, ticketTypes }: Props) {
  const { user, state } = useAuth();
  const { reserveTickets, releaseReservation, isReserving, reserveError } = useReservation(eventId);
  const { createPaymentOrder, openCheckout, isCreatingOrder, isVerifying, createOrderError, verifyError } =
    usePayment(user);

  const [bookingState, setBookingState] = useState<BookingState>({ phase: 'idle' });
  const defaultType = ticketTypes.find((t) => t.availableTickets > 0) ?? ticketTypes[0];
  const [selectedTypeId, setSelectedTypeId] = useState<string>(defaultType?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [payError, setPayError] = useState<string | null>(null);

  const selectedType = ticketTypes.find((t) => t.id === selectedTypeId);
  const maxQty = selectedType ? Math.min(selectedType.availableTickets, 10) : 1;
  const totalPrice = selectedType ? selectedType.price * quantity : 0;

  if (soldOut) {
    return (
      <Button disabled className="w-full">
        Sold out
      </Button>
    );
  }

  if (state === 'loading') {
    return <div className="h-11 w-full animate-pulse rounded-full bg-sunk" aria-hidden />;
  }

  if (!user) {
    return (
      <ButtonLink
        href={`/auth/login?next=${encodeURIComponent(`/events/${eventId}`)}`}
        className="w-full"
      >
        Sign in to book
      </ButtonLink>
    );
  }

  if (ticketTypes.length === 0) {
    return (
      <Button disabled className="w-full">
        No tickets on sale yet
      </Button>
    );
  }

  // --- Expired state ---
  if (bookingState.phase === 'expired') {
    return (
      <div className="space-y-3">
        <Notice
          tone="danger"
          title="Reservation expired"
          detail="Seats have been returned to inventory. Reserve again to continue."
        />
        <Button
          className="w-full"
          onClick={() => {
            setQuantity(1);
            setPayError(null);
            setBookingState({ phase: 'idle' });
          }}
        >
          Start over
        </Button>
      </div>
    );
  }

  // --- Reserved — show timer + pay button ---
  if (bookingState.phase === 'reserved' || bookingState.phase === 'paying') {
    const res = bookingState as Extract<BookingState, { phase: 'reserved' | 'paying' }>;
    const { ticketIds, expiresAt, selectedType: type, quantity: qty } = res as Extract<BookingState, { phase: 'reserved' }>;

    return (
      <div className="space-y-3">
        <ReservationTimer
          expiresAt={expiresAt}
          ticketIds={ticketIds}
          onRelease={(ids) => {
            for (const id of ids) {
              void releaseReservation(id);
            }
          }}
          onExpired={() => setBookingState({ phase: 'expired' })}
        />

        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">
            {qty}× {type?.name}
          </span>
          <span className="font-semibold">{formatPrice(totalPrice)}</span>
        </div>

        {(payError ?? verifyError ?? createOrderError) && (
          <Notice
            title={payError ?? (verifyError instanceof ApiClientError ? verifyError.title : 'Payment failed')}
            detail={
              verifyError instanceof ApiClientError
                ? verifyError.detail
                : createOrderError instanceof ApiClientError
                  ? createOrderError.detail
                  : 'Try again or wait for your hold to expire.'
            }
          />
        )}

        <Button
          className="w-full"
          disabled={isCreatingOrder || isVerifying}
          onClick={async () => {
            setPayError(null);
            setBookingState({ ...res, phase: 'paying' });
            try {
              const order = await createPaymentOrder(ticketIds);
              await openCheckout(order, () => {
                // Dismissed: go back to reserved state so user can retry
                setBookingState({ ...res, phase: 'reserved' });
              });
            } catch (err) {
              setBookingState({ ...res, phase: 'reserved' });
              if (err instanceof ApiClientError) {
                setPayError(err.title);
              } else {
                setPayError('Payment could not be started. Try again.');
              }
            }
          }}
        >
          {isCreatingOrder || isVerifying ? 'Processing…' : `Pay ${formatPrice(totalPrice)}`}
        </Button>
      </div>
    );
  }

  // --- Idle — ticket selector + reserve button ---
  const handleReserve = async () => {
    if (!selectedType) return;
    setPayError(null);
    try {
      const result = await reserveTickets({ ticketDescriptionId: selectedTypeId, quantity });
      setBookingState({
        phase: 'reserved',
        ticketIds: result.ticketIds,
        expiresAt: result.expiresAt,
        selectedType,
        quantity,
      });
    } catch {
      // reserveError is bound from the hook; rendered below
    }
  };

  return (
    <div className="space-y-3">
      {/* Ticket type selector */}
      {ticketTypes.length > 1 && (
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-fg" htmlFor="ticket-type-select">
            Ticket type
          </label>
          <select
            id="ticket-type-select"
            className="form-select w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-fg transition focus:border-accent focus:ring-0"
            value={selectedTypeId}
            onChange={(e) => {
              setSelectedTypeId(e.target.value);
              setQuantity(1);
            }}
          >
            {ticketTypes.map((t) => (
              <option key={t.id} value={t.id} disabled={t.availableTickets === 0}>
                {t.name} — {formatPrice(t.price)}{t.availableTickets === 0 ? ' (Sold out)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Quantity picker */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted">Quantity</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Decrease quantity"
            className="grid size-8 place-items-center rounded-full border border-line text-muted transition hover:border-line-strong hover:text-fg disabled:pointer-events-none disabled:opacity-40"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          >
            −
          </button>
          <span className="tabular w-5 text-center text-sm font-semibold">{quantity}</span>
          <button
            type="button"
            aria-label="Increase quantity"
            className="grid size-8 place-items-center rounded-full border border-line text-muted transition hover:border-line-strong hover:text-fg disabled:pointer-events-none disabled:opacity-40"
            disabled={quantity >= maxQty}
            onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
          >
            +
          </button>
        </div>
      </div>

      {/* Price */}
      {selectedType && (
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">Total</span>
          <span className="font-semibold">{formatPrice(totalPrice)}</span>
        </div>
      )}

      {/* Reserve error */}
      {reserveError && (
        <Notice
          title={reserveError instanceof ApiClientError ? reserveError.title : 'Could not reserve tickets'}
          detail={reserveError instanceof ApiClientError ? reserveError.detail : undefined}
        />
      )}

      <Button
        className="w-full"
        disabled={isReserving || !selectedType || maxQty === 0}
        onClick={() => void handleReserve()}
      >
        {isReserving ? 'Reserving…' : 'Reserve tickets'}
      </Button>
    </div>
  );
}
