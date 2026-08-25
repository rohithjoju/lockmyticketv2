'use client';

import { useEffect, useState } from 'react';
import { formatDateTime, formatRange, localZone, zoneLabel } from '@/lib/datetime';

/**
 * R6 — the wire carries UTC; this is the only place it becomes a wall clock.
 *
 * The server has no idea what zone the reader is in, so it renders the venue's
 * zone and the first client render matches it exactly. An effect then swaps to
 * the reader's real zone. Doing the swap in an effect rather than at first
 * render is what keeps hydration honest: no `suppressHydrationWarning`, no
 * mismatch, and no flash of the wrong evening.
 *
 * Offsets come from Intl, which resolves them per instant, so a March event in
 * a DST zone renders in summer time and a January one in winter time.
 */
const VENUE_ZONE = 'Asia/Kolkata';

export function LocalTime({
  iso,
  endIso,
  showZone = false,
  className,
}: {
  iso: string;
  endIso?: string;
  showZone?: boolean;
  className?: string;
}) {
  const [zone, setZone] = useState<string>(VENUE_ZONE);

  useEffect(() => setZone(localZone()), []);

  const text = endIso ? formatRange(iso, endIso, zone) : formatDateTime(iso, zone);

  return (
    <time dateTime={iso} className={className}>
      {text}
      {showZone ? <span className="text-muted"> {zoneLabel(iso, zone)}</span> : null}
    </time>
  );
}
