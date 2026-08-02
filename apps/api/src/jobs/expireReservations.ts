import { sql } from '../db/transaction.ts';
import { logger } from '../lib/logger.ts';

/** §9 — an expiry sweep this slow means the partial index is not being used. */
const SLOW_RUN_MS = 5_000;

/**
 * Restores inventory for lapsed reservations (§7.6). Runs every 60s.
 *
 * All of the work is inside expire_reservations() (§5.3), which uses
 * `for update skip locked` so overlapping runs — or several API instances —
 * cannot double-restore a seat. This wrapper exists only to log and measure.
 */
export async function runExpireReservations(): Promise<number> {
  const startedAt = Date.now();

  const rows = (await sql`select expire_reservations() as n`) as Array<{ n: number }>;
  const restored = rows[0]?.n ?? 0;
  const durationMs = Date.now() - startedAt;

  if (durationMs > SLOW_RUN_MS) {
    logger.warn({ durationMs, restored }, 'expire_reservations exceeded its latency budget');
  } else if (restored > 0) {
    logger.info({ restored, durationMs }, 'expired lapsed reservations');
  }

  return restored;
}
