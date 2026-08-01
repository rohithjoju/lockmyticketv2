import {
  ERROR_DEFAULT_MESSAGE,
  ERROR_HTTP_STATUS,
  type ApiResponse,
  type ErrorCode,
} from '@event-ticketing/types';

/**
 * The only error type routes and services should throw (SPEC §6.2).
 * HTTP status is derived from the code — never passed in (R9).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly field: string | undefined;
  /** Extra headers the error implies, e.g. Retry-After for RATE_LIMITED. */
  readonly headers: Record<string, string>;
  /** Internal detail for logs only. Never serialized to the client. */
  readonly detail: unknown;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      field?: string;
      headers?: Record<string, string>;
      detail?: unknown;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? ERROR_DEFAULT_MESSAGE[code], { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.field = options.field;
    this.headers = options.headers ?? {};
    this.detail = options.detail;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

/** Success envelope (R9). */
export function toEnvelope<T>(
  data: T,
  meta: { requestId: string; cursor?: string | null; total?: number },
): ApiResponse<T> {
  return { success: true, data, meta, error: null };
}

/** Failure envelope (R9). INTERNAL_ERROR never leaks the underlying message. */
export function toErrorEnvelope(error: AppError, requestId: string): ApiResponse<never> {
  const message =
    error.code === 'INTERNAL_ERROR' ? ERROR_DEFAULT_MESSAGE.INTERNAL_ERROR : error.message;

  return {
    success: false,
    data: null,
    meta: { requestId },
    error: {
      code: error.code,
      message,
      ...(error.field ? { field: error.field } : {}),
    },
  };
}

/** Normalizes anything thrown into an AppError. */
export function asAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError('INTERNAL_ERROR', { detail: err, cause: err });
}
