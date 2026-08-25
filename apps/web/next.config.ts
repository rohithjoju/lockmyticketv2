import type { NextConfig } from 'next';

/**
 * The §4.2 contract names these without a NEXT_PUBLIC_ prefix, but the browser
 * needs them. Rather than adding keys to the contract, they are inlined here
 * at build time. Nothing secret crosses over: the API base URL is visible in
 * every network request the browser makes anyway, and the anon key is the key
 * Supabase publishes to browsers by design.
 *
 * SUPABASE_SERVICE_ROLE_KEY is deliberately absent and must stay absent — it
 * is API-only (§4.2).
 */
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.API_URL ?? 'http://localhost:3001',
    NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? '',
  },

  // The shared packages ship TypeScript source, not a build artifact.
  transpilePackages: ['@event-ticketing/types'],

  // Cloudinary is the only image host we serve event media from.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            // `camera` stays open: the organizer QR scanner needs it (Phase 7).
            value: 'camera=(self), microphone=(), geolocation=(self), payment=(self)',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
