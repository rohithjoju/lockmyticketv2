'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { loginHref } from '@/lib/returnTo';

/**
 * The auth guard (R4, third layer).
 *
 * This is a redirect, not a permission check — RLS and the API middleware are
 * what actually stop a request. What this does is spare someone the trip: it
 * sends a signed-out reader to sign in, carrying where they were headed so
 * they land back there instead of on a generic dashboard.
 *
 * `replace`, not `push`, so Back does not bounce them into the guard again.
 */
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  const returnTo = search ? `${pathname}?${search}` : pathname;

  useEffect(() => {
    if (state === 'anonymous') router.replace(loginHref(returnTo));
  }, [state, router, returnTo]);

  if (state !== 'authenticated') {
    return (
      <div className="mx-auto max-w-6xl px-5 py-20" aria-busy="true">
        <div className="h-8 w-56 animate-pulse rounded-full bg-sunk" />
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((slot) => (
            <div key={slot} className="h-44 animate-pulse rounded-[--radius-stub] bg-sunk" />
          ))}
        </div>
        <span className="sr-only">Checking your session</span>
      </div>
    );
  }

  return <>{children}</>;
}
