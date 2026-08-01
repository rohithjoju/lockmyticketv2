import { Elysia } from 'elysia';
import { pingDatabase } from '../db/transaction.ts';
import { pingRedis } from '../db/redis.ts';
import { toEnvelope } from '../lib/errors.ts';
import { requestIdPlugin } from '../middleware/requestId.ts';

/**
 * Liveness + dependency check (§6.3). Returns 200 only when the database is
 * reachable; Redis being down is degraded, not dead, because rate limiting
 * fails open (F14).
 */
export const healthRoutes = new Elysia()
  .use(requestIdPlugin)
  .get('/health', async ({ requestId, set }) => {
  const [database, redisUp] = await Promise.all([pingDatabase(), pingRedis()]);

  const status = database ? (redisUp ? 'ok' : 'degraded') : 'unhealthy';
  if (!database) set.status = 503;

  return toEnvelope(
    {
      status,
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: { database, redis: redisUp },
    },
    { requestId },
  );
});
