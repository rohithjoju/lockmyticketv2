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

  // --- Unified 1-Click Action: Reserve & immediately open checkout ---
  const handleBookNow = async () => {
    if (!selectedType) return;
    setPayError(null);
    try {
      // Step 1: Reserve seats atomically (10-minute hold lock begins)
      const res = await reserveTickets({ ticketDescriptionId: selectedTypeId, quantity });
      
      const reservedBooking: BookingState = {
        phase: 'paying',
        ticketIds: res.ticketIds,
        expiresAt: res.expiresAt,
        selectedType,
        quantity,
      };
      setBookingState(reservedBooking);

      // Step 2: Directly trigger Razorpay payment order & checkout modal in the same user gesture
      try {
        const order = await createPaymentOrder(res.ticketIds);
        await openCheckout(order, () => {
          // If modal dismissed/cancelled, keep reservation active and let user retry anytime during 10-min hold
          setBookingState({
            phase: 'reserved',
            ticketIds: res.ticketIds,
            expiresAt: res.expiresAt,
            selectedType,
            quantity,
          });
        });
      } catch (err) {
        setBookingState({
          phase: 'reserved',
          ticketIds: res.ticketIds,
          expiresAt: res.expiresAt,
          selectedType,
          quantity,
        });
        if (err instanceof ApiClientError) {
          setPayError(err.title);
        } else {
          setPayError('Payment gateway could not be opened. You can retry below while your seat is held.');
        }
      }
    } catch {
      // reserveError is handled and displayed via useReservation hook state
    }
  };

  const isBusy = isReserving || isCreatingOrder || isVerifying;

  return (
    <div className="space-y-4">
      {/* Tier selection: Direct visual cards instead of a hidden dropdown */}
      {ticketTypes.length > 1 ? (
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted">
            Select tier
          </label>
          <div className="grid gap-2">
            {ticketTypes.map((t) => {
              const isSelected = t.id === selectedTypeId;
              const isTierSoldOut = t.availableTickets === 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={isTierSoldOut}
                  onClick={() => {
                    setSelectedTypeId(t.id);
                    setQuantity((prev) => Math.min(prev, Math.min(t.availableTickets, 10) || 1));
                  }}
                  className={`flex items-center justify-between rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? 'border-accent bg-accent/10 ring-1 ring-accent'
                      : 'border-line bg-surface hover:border-line-strong'
                  } ${isTierSoldOut ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-sm font-semibold text-fg">{t.name}</p>
                    {t.availableTickets > 0 && t.availableTickets <= 20 ? (
                      <p className="tabular text-[11px] font-medium text-danger">
                        Only {t.availableTickets} left
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="tabular text-sm font-bold text-fg">
                      {formatPrice(t.price)}
                    </span>
                    {isTierSoldOut ? (
                      <span className="block text-[10px] uppercase text-danger font-bold">
                        Sold out
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Quantity Selector with quick-select preset chips */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Tickets
          </span>
          <span className="tabular text-xs text-muted">
            Max {maxQty} per order
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Quick numbers: 1, 2, 4 for immediate single-click selection */}
          {[1, 2, 4].filter((n) => n <= maxQty).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setQuantity(n)}
              className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold tabular transition ${
                quantity === n
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg'
              }`}
            >
              {n}
            </button>
          ))}

          {/* Stepper for fine-grained selection */}
          <div className="flex items-center rounded-lg border border-line bg-surface px-1 py-0.5">
            <button
              type="button"
              aria-label="Decrease quantity"
              className="grid size-7 place-items-center rounded-md text-muted hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
              disabled={quantity <= 1}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <span className="tabular w-6 text-center text-xs font-bold text-fg">
              {quantity}
            </span>
            <button
              type="button"
              aria-label="Increase quantity"
              className="grid size-7 place-items-center rounded-md text-muted hover:text-fg disabled:opacity-30 disabled:pointer-events-none"
              disabled={quantity >= maxQty}
              onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Summary line */}
      {selectedType ? (
        <div className="flex items-baseline justify-between border-t border-line/60 pt-3 text-sm">
          <span className="text-muted">
            Total ({quantity} {quantity === 1 ? 'ticket' : 'tickets'})
          </span>
          <span className="tabular text-lg font-bold text-fg">
            {formatPrice(totalPrice)}
          </span>
        </div>
      ) : null}

      {/* Error state if hold fails */}
      {reserveError ? (
        <Notice
          title={reserveError instanceof ApiClientError ? reserveError.title : 'Could not reserve tickets'}
          detail={reserveError instanceof ApiClientError ? reserveError.detail : undefined}
        />
      ) : null}

      {/* Primary 1-Click Action Button */}
      <Button
        className="w-full text-base py-3 font-semibold shadow-sm hover:shadow transition-all"
        disabled={isBusy || !selectedType || maxQty === 0}
        onClick={() => void handleBookNow()}
      >
        {isBusy ? (
          <span className="flex items-center gap-2">
            <span className="size-2 animate-ping rounded-full bg-accent-fg" aria-hidden />
            Securing your seat…
          </span>
        ) : (
          `Lock & Pay · ${formatPrice(totalPrice)}`
        )}
      </Button>

      {/* Floating Sticky Mobile Booking Bar: 1 click away anywhere while scrolling */}
      <div className="fixed inset-x-0 bottom-14 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-between gap-3 max-w-md mx-auto">
          <div className="min-w-0">
            <p className="tabular text-sm font-bold text-fg">{formatPrice(totalPrice)}</p>
            <p className="truncate text-[11px] text-muted">
              {quantity}× {selectedType?.name ?? 'Ticket'}
            </p>
          </div>
          <Button
            className="px-6 py-2.5 text-xs font-semibold shrink-0"
            disabled={isBusy || !selectedType || maxQty === 0}
            onClick={() => void handleBookNow()}
          >
            {isBusy ? 'Securing…' : 'Lock & Pay'}
          </Button>
        </div>
      </div>
    </div>
  );
}
