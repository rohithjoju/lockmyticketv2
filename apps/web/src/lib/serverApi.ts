import 'server-only';
import type { ApiMeta } from '@event-ticketing/types';
import { ApiClientError, apiFetch, type RequestOptions } from './apiClient';

/**
 * Server components read public data through here.
 *
 * There is deliberately no token: a server component has no refresh cookie to
 * spend and no session of its own, so anything it renders is what an
 * anonymous visitor would see. Authenticated views are client components
 * driven by apiClient.
 *
 * `cache: 'no-store'` is inherited from apiFetch — availability counts must be
 * live on every request, never served from a cached render.
 */
export type ServerResult<T> = { data: T; meta: ApiMeta | null };

export async function serverApi<T>(
  path: string,
  options: Omit<RequestOptions, 'accessToken'> = {},
): Promise<ServerResult<T>> {
  return apiFetch<T>(path, options);
}

/**
 * The same call, but a NOT_FOUND becomes `null` instead of a throw, so a page
 * can hand it to `notFound()` and render the 404 route. Any other failure
 * still propagates to the error boundary — a 502 is not a missing event.
 */
export async function serverApiOrNull<T>(
  path: string,
  options: Omit<RequestOptions, 'accessToken'> = {},
): Promise<ServerResult<T> | null> {
  try {
    return await serverApi<T>(path, options);
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}
