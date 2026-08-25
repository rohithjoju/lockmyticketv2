import type { ApiMeta, ApiResponse, ErrorCode } from '@event-ticketing/types';
import { copyFor, isErrorCode } from './errorCopy';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const API_PREFIX = '/api/v1';

/**
 * A failed call, already translated. `title`/`detail` are safe to render; the
 * raw `message` from the API is kept for logs, never for the screen — an
 * INTERNAL_ERROR message must never reach a reader (§8).
 */
export class ApiClientError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly field: string | undefined;
  readonly requestId: string | null;
  readonly title: string;
  readonly detail: string;

  constructor(init: {
    code: ErrorCode;
    status: number;
    message: string;
    field?: string | undefined;
    requestId: string | null;
  }) {
    super(init.message);
    this.name = 'ApiClientError';
    this.code = init.code;
    this.status = init.status;
    this.field = init.field;
    this.requestId = init.requestId;
    const copy = copyFor(init.code);
    this.title = copy.title;
    this.detail = copy.detail;
  }
}

export type ApiResult<T> = { data: T; meta: ApiMeta | null };

export type RequestOptions = {
  method?: string;
  /** Serialised as JSON unless it is already a FormData. */
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  /** Server components pass this; the browser client never does. */
  accessToken?: string | null;
  /** Opt out of the refresh-and-retry dance (used by the refresh call itself). */
  noRetry?: boolean;
};

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = new URL(`${API_PREFIX}${path}`, API_BASE);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Turns any response into either a result or an ApiClientError.
 *
 * A response that is not the envelope at all — an HTML 502 from a proxy, a
 * dropped connection mid-body — is a real failure mode, so it is mapped to a
 * registered code rather than throwing a SyntaxError at the call site (R9).
 */
async function readEnvelope<T>(response: Response): Promise<ApiResult<T>> {
  let envelope: ApiResponse<T> | null = null;
  try {
    envelope = (await response.json()) as ApiResponse<T>;
  } catch {
    envelope = null;
  }

  const requestId = envelope?.meta?.requestId ?? response.headers.get('x-request-id');

  if (!envelope || typeof envelope.success !== 'boolean') {
    throw new ApiClientError({
      code: response.status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'INTERNAL_ERROR',
      status: response.status,
      message: `Non-envelope response (${response.status})`,
      requestId,
    });
  }

  if (!envelope.success || envelope.error) {
    const raw = envelope.error?.code;
    throw new ApiClientError({
      code: isErrorCode(raw) ? raw : 'INTERNAL_ERROR',
      status: response.status,
      message: envelope.error?.message ?? 'Request failed',
      field: envelope.error?.field,
      requestId,
    });
  }

  return { data: envelope.data as T, meta: envelope.meta };
}

/**
 * One request, no session handling. Used directly by server components, which
 * have no refresh token to spend, and as the transport under the browser
 * client below.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { method = 'GET', body, query, signal, accessToken } = options;

  const headers = new Headers();
  headers.set('accept', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    // Deliberately no content-type: the browser must set the multipart boundary.
    payload = body;
  } else if (body !== undefined) {
    headers.set('content-type', 'application/json');
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: payload,
      // Carries the httpOnly refresh cookie on /auth/* calls.
      credentials: 'include',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiClientError({
      code: 'UPSTREAM_UNAVAILABLE',
      status: 0,
      message: cause instanceof Error ? cause.message : 'Network request failed',
      requestId: null,
    });
  }

  return readEnvelope<T>(response);
}

// ------------------------------------------------------------ browser session

/**
 * The access token lives in a module variable, never in localStorage or a
 * readable cookie: a script that can read storage can exfiltrate a bearer
 * token, and a page reload recovers the session from the httpOnly refresh
 * cookie anyway (see AuthProvider).
 */
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Registered by AuthProvider so a dead session can clear the UI once. */
export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

/**
 * Paths that must never trigger a refresh: /auth/refresh would recurse, and
 * the rest are the ways in for someone who has no session to refresh.
 */
const NO_REFRESH_PATHS = new Set([
  '/auth/refresh',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

/** One refresh at a time — ten concurrent 401s must not mint ten tokens. */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const { data } = await apiFetch<{ accessToken: string }>('/auth/refresh', {
        method: 'POST',
        noRetry: true,
      });
      setAccessToken(data.accessToken);
      return data.accessToken;
    } catch {
      setAccessToken(null);
      onSessionLost?.();
      return null;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all see the
      // same outcome before a fresh attempt can start.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

function isExpiredSession(error: unknown): error is ApiClientError {
  return (
    error instanceof ApiClientError &&
    error.status === 401 &&
    (error.code === 'TOKEN_EXPIRED' || error.code === 'UNAUTHENTICATED')
  );
}

/**
 * The browser client. On a 401 it refreshes once, retries once, and gives up —
 * never a loop. Every other failure surfaces as an ApiClientError carrying
 * copy the caller can render.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const attempt = (token: string | null) => apiFetch<T>(path, { ...options, accessToken: token });

  try {
    return await attempt(accessToken);
  } catch (error) {
    if (options.noRetry || NO_REFRESH_PATHS.has(path) || !isExpiredSession(error)) throw error;

    const fresh = await refreshAccessToken();
    if (!fresh) throw error;

    return attempt(fresh);
  }
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    api<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    api<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    api<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    api<T>(path, { ...options, method: 'DELETE' }),
};

/** Test seam: drops the module-level session so suites cannot leak into each other. */
export function __resetApiClientForTests(): void {
  accessToken = null;
  onSessionLost = null;
  refreshInFlight = null;
}
