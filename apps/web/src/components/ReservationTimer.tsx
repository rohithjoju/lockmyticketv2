'use client';

import { useEffect, useRef, useState } from 'react';
import { formatCountdown } from '@/lib/datetime';

type Props = {
  expiresAt: string; // ISO UTC timestamptz from the API
  onExpired: () => void;
  onRelease?: (ticketIds: string[]) => void;
  ticketIds?: string[];
};

/**
 * Epic 1.2 — 10-minute countdown timer.
 *
 * - Receives `expiresAt` (ISO UTC) from a successful POST /events/:id/reserve.
 * - Ticks every second; under 60s turns urgent/red.
 * - On expiry calls `onRelease` (which calls `releaseReservation` in the hook)
 *   then `onExpired` to reset the booking UI back to "Reserve" state.
 */
export function ReservationTimer({ expiresAt, onExpired, onRelease, ticketIds = [] }: Props) {
  const expiry = useRef(new Date(expiresAt).getTime());
  const [msLeft, setMsLeft] = useState(() => Math.max(0, expiry.current - Date.now()));
  const expired = useRef(false);

  useEffect(() => {
    expiry.current = new Date(expiresAt).getTime();
    setMsLeft(Math.max(0, expiry.current - Date.now()));
    expired.current = false;
  }, [expiresAt]);

  useEffect(() => {
    const id = setInterval(() => {
      const remaining = expiry.current - Date.now();
      if (remaining <= 0) {
        setMsLeft(0);
        clearInterval(id);
        if (!expired.current) {
          expired.current = true;
          // Release held tickets then signal parent to reset UI
          if (onRelease && ticketIds.length > 0) {
            for (const ticketId of ticketIds) {
              onRelease([ticketId]);
            }
          }
          onExpired();
        }
      } else {
        setMsLeft(remaining);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpired, onRelease, ticketIds]);

  const isUrgent = msLeft <= 60_000;
  const isExpired = msLeft === 0;

  if (isExpired) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-danger/40 bg-danger/8 px-4 py-3"
      >
        <p className="text-sm font-semibold text-danger">Reservation expired</p>
        <p className="mt-0.5 text-sm text-muted">
          Seats have been returned to inventory. Reserve again to continue.
        </p>
      </div>
    );
  }

  return (
    <div
      role="timer"
      aria-label={`${formatCountdown(msLeft)} remaining to complete your purchase`}
      className={`flex items-center justify-between rounded-xl border px-4 py-2.5 ${
        isUrgent
          ? 'border-danger/40 bg-danger/8 text-danger'
          : 'border-line bg-sunk text-muted'
      }`}
    >
      <span className="text-sm font-medium">Hold expires in</span>
      <span className={`tabular font-mono text-lg font-semibold ${isUrgent ? 'text-danger' : 'text-fg'}`}>
        {formatCountdown(msLeft)}
      </span>
    </div>
  );
}
