import { SQL, type TransactionSQL } from 'bun';
import { getEnv } from '@event-ticketing/config';

const env = getEnv();

/**
 * Direct Postgres pool.
 *
 * supabase-js issues one HTTP request per call and cannot hold a transaction
 * open across statements, but R2 requires payment confirmation, ticket
 * issuance, and inventory changes to commit or roll back together. Money paths
 * therefore go through this pool; supabase-js remains for Storage and
 * RLS-scoped reads.
 */
export const sql = new SQL({
  url: env.DATABASE_URL,
  max: 10,
  idleTimeout: 30,
  connectionTimeout: 10,
});

/** The transaction handle passed to withTransaction callbacks. */
export type Tx = TransactionSQL;

/**
 * Runs `fn` inside a single BEGIN/COMMIT. Any throw rolls the whole thing
 * back (R2). Never perform third-party I/O in here — queue it after the
 * transaction commits (R5).
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin((tx) => fn(tx))) as T;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Renders a uuid list as a Postgres array literal for `= any($1::uuid[])`.
 *
 * Bun's SQL client serialises a JS array by joining it with commas, which
 * Postgres then rejects as a malformed array literal. The literal is still
 * passed as a single bound parameter, so nothing is interpolated into SQL —
 * but each id is shape-checked anyway, because a value that is not a uuid here
 * means a bug upstream and should fail before it reaches the database.
 */
export function uuidArray(ids: readonly string[]): string {
  for (const id of ids) {
    if (!UUID_RE.test(id)) throw new TypeError(`not a uuid: ${id}`);
  }
  return `{${ids.join(',')}}`;
}

/** Liveness probe for /health. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await sql.close();
}
