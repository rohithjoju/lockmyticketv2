import { NextResponse } from 'next/server';
import { ApiClientError, apiFetch } from '@/lib/apiClient';

export const dynamic = 'force-dynamic';

/**
 * Liveness for the web tier, plus reachability of the API it depends on.
 *
 * Deliberately shallow: it does not reach past the API into Postgres or Redis
 * — /api/v1/health owns that, and a web probe that fails because Redis blinked
 * would take the storefront down for a problem it cannot fix.
 *
 * Uses the §6.1 envelope so a single monitor can parse both tiers (R9).
 */
export async function GET() {
  const startedAt = Date.now();

  let api: { reachable: boolean; status: string | null; error: string | null };
  try {
    const { data } = await apiFetch<{ status?: string }>('/health');
    api = { reachable: true, status: data?.status ?? 'ok', error: null };
  } catch (cause) {
    api = {
      reachable: false,
      status: null,
      error: cause instanceof ApiClientError ? cause.code : 'INTERNAL_ERROR',
    };
  }

  return NextResponse.json(
    {
      success: api.reachable,
      data: { status: api.reachable ? 'ok' : 'degraded', api, durationMs: Date.now() - startedAt },
      meta: { requestId: crypto.randomUUID() },
      error: api.reachable
        ? null
        : { code: 'UPSTREAM_UNAVAILABLE', message: 'The API is not reachable from the web tier.' },
    },
    { status: api.reachable ? 200 : 503 },
  );
}
