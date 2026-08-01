import { Elysia } from 'elysia';
import { logger, requestLogger, type Logger } from '../lib/logger.ts';

/** Short, log-friendly correlation id (§9). */
export function newRequestId(): string {
  return `req_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

/**
 * Assigns a requestId to every request and logs method/path/status/duration
 * (§9). The id is echoed in the response envelope's `meta` and in the
 * `X-Request-Id` header so a user-reported error can be traced to a log line.
 */
export const requestIdPlugin = new Elysia({ name: 'requestId' })
  .derive({ as: 'global' }, ({ request }) => {
    const requestId = request.headers.get('x-request-id') ?? newRequestId();
    return { requestId, log: requestLogger(requestId), startedAt: performance.now() };
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
