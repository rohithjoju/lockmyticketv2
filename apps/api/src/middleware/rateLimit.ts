import { getEnv } from '@event-ticketing/config';
import { redis } from '../db/redis.ts';
import { AppError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';

const env = getEnv();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Redis sliding-window limiter (§8).
 *
 * F14: if Redis is unreachable this fails **OPEN** — a Redis blip must never
 * cost a sale. The failure is logged so the gap is visible.
 */
export async function checkRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const { key, limit, windowSeconds } = input;
  const redisKey = `ratelimit:${key}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  try {
    const results = await redis
      .multi()
      .zremrangebyscore(redisKey, 0, windowStart)
      .zadd(redisKey, now, `${now}-${Math.random()}`)
      .zcard(redisKey)
      .expire(redisKey, windowSeconds)
      .exec();

    const count = Number(results?.[2]?.[1] ?? 0);

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: windowSeconds,
    };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, key },
      'rate limiter unavailable — failing open (F14)',
    );
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

/** Throws RATE_LIMITED (429) with Retry-After when the window is exhausted. */
export async function enforceRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<void> {
  const result = await checkRateLimit(input);
  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', {
      headers: { 'retry-after': String(result.retryAfterSeconds) },
    });
  }
}

/** Global per-IP limit (§8: 100/min/IP by default). */
export function globalLimit(ip: string) {
  return enforceRateLimit({
    key: `global:${ip}`,
    limit: env.API_RATE_LIMIT_PER_MINUTE,
    windowSeconds: 60,
  });
}

/** Stricter per-IP limit on login (§8: 10/min/IP). */
export function loginLimit(ip: string) {
  return enforceRateLimit({ key: `login:${ip}`, limit: 10, windowSeconds: 60 });
}
