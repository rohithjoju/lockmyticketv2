/**
 * The post-sign-in destination, carried in `?next=`.
 *
 * Anything that is not a same-site absolute path is dropped. A query
 * parameter that ends up in a redirect is an open-redirect waiting to happen,
 * and `//evil.example` is a protocol-relative URL that a naive
 * `startsWith('/')` check would wave through.
 */
export const RETURN_PARAM = 'next';

const FALLBACK = '/dashboard';

export function safeReturnTo(raw: string | null | undefined, fallback = FALLBACK): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}

/** Builds the sign-in URL that will come back to `pathname`. */
export function loginHref(pathname: string): string {
  return `/auth/login?${RETURN_PARAM}=${encodeURIComponent(pathname)}`;
}
