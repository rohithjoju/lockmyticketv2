import { NextResponse, type NextRequest } from 'next/server';

const API_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').origin;
  } catch {
    return 'http://localhost:3001';
  }
})();

/**
 * §8 — CSP, with a per-request nonce.
 *
 * Next injects inline <script> tags to stream the RSC payload, so the policy
 * cannot simply forbid inline script. A nonce is the alternative to
 * 'unsafe-inline', and Next picks it up automatically when it sees one on the
 * request's Content-Security-Policy header.
 *
 * The cost is that every route renders dynamically, which is the right trade
 * here: ticket availability must never be served from a cached render.
 *
 * style-src still needs 'unsafe-inline'. React writes inline `style`
 * attributes for anything computed at render, and there is no nonce mechanism
 * for those. Inline styles are not an injection vector on their own.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https://res.cloudinary.com`,
    `font-src 'self' data:`,
    `connect-src 'self' ${API_ORIGIN}`,
    `media-src 'self' https://res.cloudinary.com`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const policy = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  matcher: [
    // Everything except Next's own static output and image optimiser: those
    // are already-built assets and carry no HTML for a nonce to protect.
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
