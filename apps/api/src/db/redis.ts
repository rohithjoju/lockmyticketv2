import { Redis } from 'ioredis';
import { getEnv } from '@event-ticketing/config';
import { logger } from '../lib/logger.ts';

const env = getEnv();

/**
 * Redis is used for the refresh-token denylist and rate limiting.
 *
 * F14: Redis being down must never lose a payment. Rate limiting fails OPEN
 * (see middleware/rateLimit.ts); queues fail CLOSED. Connection errors are
 * logged, not thrown, so a blip cannot take the API down.
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 200, 5000),
});

redis.on('error', (err: Error) => {
  logger.warn({ err: err.message }, 'redis error');
});

let connectPromise: Promise<void> | null = null;

export function connectRedis(): Promise<void> {
  connectPromise ??= redis.connect().catch((err: Error) => {
    logger.warn({ err: err.message }, 'redis initial connect failed; degrading gracefully');
  });
  return connectPromise;
}

export async function pingRedis(): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
