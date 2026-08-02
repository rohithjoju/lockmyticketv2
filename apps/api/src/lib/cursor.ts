import type { Cursor } from '@event-ticketing/types';
import { AppError } from './errors.ts';

/**
 * Cursor pagination (§6.1). `cursor` is a base64url-encoded {id, sortValue}.
 *
 * Keyset, never OFFSET: an OFFSET page shifts under concurrent inserts, which
 * on a ticket-drop listing means callers see duplicates and miss rows.
 */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  const invalid = new AppError('VALIDATION_FAILED', {
    message: 'Invalid pagination cursor.',
    field: 'cursor',
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }

  const { id, sortValue } = (parsed ?? {}) as Partial<Cursor>;
  if (typeof id !== 'string' || typeof sortValue !== 'string') throw invalid;
  return { id, sortValue };
}
