/**
 * Error code registry (SPEC §6.2).
 *
 * Adding a new code requires adding it here AND to ERROR_HTTP_STATUS.
 * HTTP status is derived from the code, never set ad hoc (R9).
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'ACCOUNT_DISABLED',
  'ORGANIZER_NOT_APPROVED',
  'NOT_FOUND',
  'EMAIL_ALREADY_EXISTS',
  'TICKET_SOLD_OUT',
  'TICKET_LIMIT_EXCEEDED',
  'RESERVATION_EXPIRED',
  'TICKET_ALREADY_USED',
  'PAYMENT_ALREADY_PROCESSED',
  'INVALID_SIGNATURE',
  'REFUND_WINDOW_CLOSED',
  'REFUND_ALREADY_ISSUED',
  'VERSION_CONFLICT',
  'RATE_LIMITED',
  'ACCOUNT_LOCKED',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Canonical HTTP status for each error code. This is the single source of
 * truth; handlers must never hardcode a status alongside a code.
 */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  ACCOUNT_DISABLED: 403,
  ORGANIZER_NOT_APPROVED: 403,
  NOT_FOUND: 404,
  EMAIL_ALREADY_EXISTS: 409,
  TICKET_SOLD_OUT: 409,
  TICKET_LIMIT_EXCEEDED: 409,
  RESERVATION_EXPIRED: 409,
  TICKET_ALREADY_USED: 409,
  PAYMENT_ALREADY_PROCESSED: 409,
  INVALID_SIGNATURE: 400,
  REFUND_WINDOW_CLOSED: 409,
  REFUND_ALREADY_ISSUED: 409,
  VERSION_CONFLICT: 409,
  RATE_LIMITED: 429,
  ACCOUNT_LOCKED: 429,
  UPSTREAM_UNAVAILABLE: 502,
  INTERNAL_ERROR: 500,
};

/**
 * Default human-facing message per code. Handlers may override with a more
 * specific message, but never leak internal details for INTERNAL_ERROR.
 */
export const ERROR_DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'The request was invalid.',
  UNAUTHENTICATED: 'Authentication is required.',
  INVALID_CREDENTIALS: 'Invalid email or password.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  ACCOUNT_DISABLED: 'This account has been disabled.',
  ORGANIZER_NOT_APPROVED: 'Your organizer account is awaiting approval.',
  NOT_FOUND: 'The requested resource was not found.',
  EMAIL_ALREADY_EXISTS: 'An account with this email already exists.',
  TICKET_SOLD_OUT: 'This ticket type is no longer available.',
  TICKET_LIMIT_EXCEEDED: 'You have reached the ticket limit for this event.',
  RESERVATION_EXPIRED: 'Your reservation has expired.',
  TICKET_ALREADY_USED: 'This ticket has already been used.',
  PAYMENT_ALREADY_PROCESSED: 'This payment has already been processed.',
  INVALID_SIGNATURE: 'The payment signature could not be verified.',
  REFUND_WINDOW_CLOSED: 'The refund window for this event has closed.',
  REFUND_ALREADY_ISSUED: 'A refund has already been issued for this ticket.',
  VERSION_CONFLICT: 'This record was modified by someone else. Please retry.',
  RATE_LIMITED: 'Too many requests. Please slow down.',
  ACCOUNT_LOCKED: 'Account temporarily locked due to too many attempts.',
  UPSTREAM_UNAVAILABLE: 'A third-party service is currently unavailable.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
};

export function httpStatusForCode(code: ErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}
