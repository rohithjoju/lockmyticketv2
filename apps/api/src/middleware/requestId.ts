import { Elysia } from 'elysia';
import { logger, requestLogger, type Logger } from '../lib/logger.ts';

/** Short, log-friendly correlation id (§9). */
export function newRequestId(): string {
  return `req_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

/**
 * The caller's address, for rate-limit keys and `audit_logs.ip_address`.
 *
 * `x-forwarded-for` is spoofable by anyone talking to the API directly, so it
 * is only meaningful behind a proxy that overwrites it. The socket address is
 * the fallback, and 'unknown' is a valid answer rather than a fabricated one.
 */
export function clientIp(
  request: Request,
  server: { requestIP?: (request: Request) => { address: string } | null } | null,
): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    server?.requestIP?.(request)?.address ??
    'unknown'
  );
}

/**
 * Assigns a requestId to every request and logs method/path/status/duration
 * (§9). The id is echoed in the response envelope's `meta` and in the
 * `X-Request-Id` header so a user-reported error can be traced to a log line.
 */
export const requestIdPlugin = new Elysia({ name: 'requestId' })
  .derive({ as: 'global' }, ({ request, server }) => {
    const requestId = request.headers.get('x-request-id') ?? newRequestId();
    return {
      requestId,
      clientIp: clientIp(request, server),
      log: requestLogger(requestId),
      startedAt: performance.now(),
    };
  })
  .onAfterHandle({ as: 'global' }, ({ requestId, set }) => {
    set.headers['x-request-id'] = requestId;
  })
  .onAfterResponse({ as: 'global' }, (ctx) => {
    // Elysia does not guarantee derived values on this hook (it can fire on a
    // context that skipped `derive`). Access logging must never break a
    // response, so fall back to the root logger rather than throwing.
    const { request, path, set } = ctx;
    const requestId = (ctx as { requestId?: string }).requestId;
    const startedAt = (ctx as { startedAt?: number }).startedAt;
    const log = (ctx as { log?: Logger }).log ?? logger;

    log.info(
      {
        method: request.method,
        path,
        statusCode: typeof set.status === 'number' ? set.status : 200,
        ...(startedAt !== undefined
          ? { durationMs: Math.round(performance.now() - startedAt) }
          : {}),
        ...(requestId ? { requestId } : {}),
      },
      'request',
    );
  });
