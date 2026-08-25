/**
 * R6 — the API stores and returns UTC `timestamptz`. Conversion to a wall
 * clock happens here and nowhere else, at render time.
 *
 * Every function takes the ISO string straight off the wire and an optional
 * IANA zone. The zone argument exists so this is testable across a DST
 * boundary without moving the machine's clock: Intl resolves the offset from
 * the instant, so 30 Mar 2025 in Europe/London is BST while 30 Jan is GMT,
 * and neither is a fixed +00:00 or +01:00 that a naive formatter would apply.
 */

export type Zone = string | undefined;

function parse(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new RangeError(`not an ISO timestamp: ${iso}`);
  return date;
}

function options(zone: Zone, extra: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  return zone ? { ...extra, timeZone: zone } : extra;
}

/** "Sat, 12 Apr 2025" */
export function formatDate(iso: string, zone?: Zone): string {
  return new Intl.DateTimeFormat('en-IN', {
    ...options(zone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
  }).format(parse(iso));
}

/** "7:30 pm" */
export function formatTime(iso: string, zone?: Zone): string {
  return new Intl.DateTimeFormat('en-IN', {
    ...options(zone, { hour: 'numeric', minute: '2-digit', hour12: true }),
  })
    .format(parse(iso))
    .toLowerCase();
}

/** "Sat, 12 Apr 2025 · 7:30 pm" */
export function formatDateTime(iso: string, zone?: Zone): string {
  return `${formatDate(iso, zone)} · ${formatTime(iso, zone)}`;
}

/**
 * The zone abbreviation the reader is actually in — "IST", "GMT", "BST".
 * Shown next to times so nobody has to guess whose evening 7:30 pm is.
 */
export function zoneLabel(iso: string, zone?: Zone): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    ...options(zone, { timeZoneName: 'short' }),
  }).formatToParts(parse(iso));
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}

/** The zone the code is running in. On the server this is the server's, which is why it is only ever called from a client component. */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * A date range written the way a person would say it: one date when the event
 * starts and ends on the same day in the reader's zone, two when it spans.
 */
export function formatRange(startIso: string, endIso: string, zone?: Zone): string {
  const sameDay = formatDate(startIso, zone) === formatDate(endIso, zone);
  return sameDay
    ? `${formatDate(startIso, zone)} · ${formatTime(startIso, zone)} – ${formatTime(endIso, zone)}`
    : `${formatDateTime(startIso, zone)} – ${formatDateTime(endIso, zone)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "in 3 days" / "in 4 hours" / "started". `now` is injectable so tests do not
 * depend on when they run.
 */
export function relativeToNow(iso: string, now: Date = new Date()): string {
  const delta = parse(iso).getTime() - now.getTime();
  if (delta <= 0) return 'started';
  if (delta < HOUR) return `in ${Math.max(1, Math.round(delta / MINUTE))} min`;
  if (delta < DAY) return `in ${Math.round(delta / HOUR)} hr`;
  const days = Math.round(delta / DAY);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** "10:00" for a countdown. Clamps at zero rather than counting backwards. */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Prices come off the wire as rupees, never paise. */
export function formatPrice(amount: number): string {
  return amount === 0
    ? 'Free'
    : new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
      }).format(amount);
}
