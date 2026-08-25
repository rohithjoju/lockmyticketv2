'use client';

import { useAuth } from '@/hooks/useAuth';
import { Button, ButtonLink } from './ui';

/**
 * The seam where Phase 7's reservation flow lands.
 *
 * Until then this does the one thing it can do honestly: send a signed-out
 * reader to sign in and bring them back here afterwards. It never claims a
 * hold it has not taken.
 */
export function BookingCta({ eventId, soldOut }: { eventId: string; soldOut: boolean }) {
  const { user, state } = useAuth();

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

  return (
    <div className="space-y-2">
      <Button disabled className="w-full">
        Reserve tickets
      </Button>
      <p className="text-center text-xs text-muted">Booking opens in the next release.</p>
    </div>
  );
}
