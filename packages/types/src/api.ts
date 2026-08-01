import type { ErrorCode } from './errors.ts';

/**
 * The response envelope (SPEC §6.1, R9).
 * Every response — success or failure — uses this shape. No bare objects,
 * no bare arrays, no inconsistent error shapes.
 */
export type ApiResponse<T> = {
  success: boolean;
  data: T | null;
  meta: ApiMeta | null;
  error: ApiError | null;
};

export type ApiMeta = {
  requestId: string;
  cursor?: string | null;
  total?: number;
};

export type ApiError = {
  code: ErrorCode;
  message: string;
  field?: string;
};

/** Cursor-based pagination payload (base64-encoded {id, sortValue}). */
export type Cursor = {
  id: string;
  sortValue: string;
};
