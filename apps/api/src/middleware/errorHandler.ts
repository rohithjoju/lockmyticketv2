import { Elysia } from 'elysia';
import { AppError, asAppError, toErrorEnvelope } from '../lib/errors.ts';
import { newRequestId } from './requestId.ts';

/**
 * Global error boundary (R9). EVERY failure — including 404s, schema
 * rejections, and unhandled throws — leaves as the §6.1 envelope.
 * Internal messages are logged, never returned (§6.2 INTERNAL_ERROR).
 */
export const errorHandlerPlugin = new Elysia({ name: 'errorHandler' }).onError(
  { as: 'global' },
  ({ code, error, set, request, ...ctx }) => {
    const requestId = (ctx as { requestId?: string }).requestId ?? newRequestId();
    const log = (ctx as { log?: { error: (o: unknown, m: string) => void } }).log;

    let appError: AppError;

    switch (code) {
      case 'VALIDATION':
        // R12 — schema rejection at the boundary. Surface the offending field.
        appError = new AppError('VALIDATION_FAILED', {
          message: 'The request did not match the expected schema.',
          field: extractField(error),
          detail: String(error),
        });
        break;
      case 'NOT_FOUND':
        appError = new AppError('NOT_FOUND', { message: 'Route not found.' });
        break;
      case 'PARSE':
        appError = new AppError('VALIDATION_FAILED', { message: 'Malformed request body.' });
        break;
      default:
        appError = asAppError(error);
    }

    if (appError.status >= 500) {
      log?.error(
        { err: appError.detail ?? appError.message, path: new URL(request.url).pathname },
        'unhandled error',
      );
    }

    set.status = appError.status;
    for (const [k, v] of Object.entries(appError.headers)) {
      set.headers[k] = v;
    }

    return toErrorEnvelope(appError, requestId);
  },
);

/** Best-effort extraction of the failing property from a TypeBox error. */
function extractField(error: unknown): string | undefined {
  const path = (error as { all?: Array<{ path?: string }> })?.all?.[0]?.path;
  return typeof path === 'string' && path.length > 1 ? path.slice(1) : undefined;
}
