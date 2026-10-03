import { ERROR_CODES, type ErrorCode } from '@event-ticketing/types';

/**
 * ErrorCode → copy the person on the other side of the screen can act on.
 *
 * The API already returns a `message`, but it is written for an API consumer.
 * These are written for a buyer standing in a queue with their phone out:
 * say what happened, then say what to do about it. Nothing here apologises,
 * and nothing here is vague.
 *
 * Keyed on the full ErrorCode union, so adding a code to the registry without
 * writing copy for it is a type error, not a raw stack trace in production.
 */
export const ERROR_COPY: Record<ErrorCode, { title: string; detail: string }> = {
  VALIDATION_FAILED: {
    title: 'Check the highlighted field',
    detail: 'Something in the form needs fixing before this can go through.',
  },
  UNAUTHENTICATED: {
    title: 'Sign in to continue',
    detail: 'This page needs to know who you are.',
  },
  INVALID_CREDENTIALS: {
    title: 'Invalid email or password',
    detail: 'Check your spelling and try again.',
  },
  TOKEN_EXPIRED: {
    title: 'Your session ended',
    detail: 'Sign in again to pick up where you left off.',
  },
  FORBIDDEN: {
    title: 'Not your account to change',
    detail: 'This action belongs to a different role.',
  },
  ACCOUNT_DISABLED: {
    title: 'This account is disabled',
    detail: 'Contact support to have it reinstated.',
  },
  ORGANIZER_NOT_APPROVED: {
    title: 'Your organizer account is still under review',
    detail: 'You can browse and buy tickets meanwhile. We will email you when it is approved.',
  },
  NOT_FOUND: {
    title: 'Nothing here',
    detail: 'This page or event does not exist, or is no longer listed.',
  },
  EMAIL_ALREADY_EXISTS: {
    title: 'That email is already registered',
    detail: 'Sign in instead, or reset the password if you have forgotten it.',
  },
  TICKET_SOLD_OUT: {
    title: 'Sold out',
    detail: 'These went while you were deciding. Try another ticket type.',
  },
  TICKET_LIMIT_EXCEEDED: {
    title: 'You have hit the limit for this event',
    detail: 'Release a ticket you are holding to reserve a different one.',
  },
  RESERVATION_EXPIRED: {
    title: 'Your hold ran out',
    detail: 'The tickets went back on sale. Reserve again to restart the timer.',
  },
  TICKET_ALREADY_USED: {
    title: 'Already scanned',
    detail: 'This ticket was checked in earlier. One entry per ticket.',
  },
  PAYMENT_ALREADY_PROCESSED: {
    title: 'Already paid',
    detail: 'This payment went through. Your tickets are in your wallet.',
  },
  INVALID_SIGNATURE: {
    title: 'We could not verify that payment',
    detail: 'Nothing was charged. Start the payment again.',
  },
  REFUND_WINDOW_CLOSED: {
    title: 'Too late to refund',
    detail: 'The refund window for this event has closed.',
  },
  REFUND_ALREADY_ISSUED: {
    title: 'Refund already on its way',
    detail: 'It reaches your original payment method in 5–7 working days.',
  },
  VERSION_CONFLICT: {
    title: 'Someone else got there first',
    detail: 'This record changed while you were working. Reload and try again.',
  },
  RATE_LIMITED: {
    title: 'Slow down a moment',
    detail: 'Too many requests from here. Wait a few seconds, then retry.',
  },
  ACCOUNT_LOCKED: {
    title: 'Sign-in locked',
    detail: 'Too many failed attempts. Try again shortly, or reset your password.',
  },
  UPSTREAM_UNAVAILABLE: {
    title: 'A service we depend on is down',
    detail: 'Nothing was lost. Try again in a minute.',
  },
  INTERNAL_ERROR: {
    title: 'Something went wrong on our side',
    detail: 'Try again. If it keeps happening, quote the request id below to support.',
  },
};

/** True for a value that is actually in the registry — API responses are input. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

export function copyFor(code: unknown): { title: string; detail: string } {
  return isErrorCode(code) ? ERROR_COPY[code] : ERROR_COPY.INTERNAL_ERROR;
}
