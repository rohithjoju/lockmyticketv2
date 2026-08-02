/**
 * Global test setup, wired via `bunfig.toml` → `[test].preload`.
 *
 * `bun test` imports test files lazily, one at a time, in a single process.
 * That means a per-file `afterAll` teardown can tear the database down while
 * later files still need it — and the app's connection pool, already imported
 * and cached, cannot be pointed at a replacement. So infrastructure is booted
 * exactly once here, before any test file loads, and torn down exactly once
 * after the last one.
 */
import { afterAll } from 'bun:test';
import { startTestEnv, stopTestEnv } from './testEnv.ts';

await startTestEnv();

afterAll(async () => {
  // BullMQ queues hold their own Redis connections; leaving them open keeps
  // the test process alive long after the last assertion.
  const { closeQueues } = await import('../../apps/api/src/queues/index.ts');
  await closeQueues().catch(() => {});

  // Release the pool before stopping Postgres, so shutdown is clean rather
  // than a race between an open socket and a dying cluster.
  const { closeDatabase } = await import('../../apps/api/src/db/transaction.ts');
  await closeDatabase().catch(() => {});

  const { closeRedis } = await import('../../apps/api/src/db/redis.ts');
  await closeRedis().catch(() => {});

  await stopTestEnv();
});
