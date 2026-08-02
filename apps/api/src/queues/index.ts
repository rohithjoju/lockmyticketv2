import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { getEnv } from '@event-ticketing/config';
import { AppError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';

const env = getEnv();

export const QUEUE_NAMES = {
  EMAIL: 'email',
  MEDIA: 'media',
  RECONCILE: 'reconcile',
} as const;

/**
 * BullMQ gets its own connection settings rather than the shared ioredis
 * client from db/redis.ts. Workers issue blocking commands, which require
 * `maxRetriesPerRequest: null`; the shared client is deliberately configured
 * the opposite way so that rate limiting can fail fast and fail open (F14).
 */
export function queueConnection(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    maxRetriesPerRequest: null,
  };
}

// ------------------------------------------------------------- job shapes

export type EmailJob =
  | { type: 'ticket_confirmation'; paymentId: string; userId: string; ticketIds: string[] }
  | { type: 'refund_issued'; refundId: string; ticketId: string; userId: string }
  | { type: 'event_changed'; eventId: string; changeReason: string }
  | { type: 'event_cancelled'; eventId: string }
  | { type: 'event_reminder'; eventId: string };

export type MediaJob = { type: 'cleanup_orphaned_uploads' };

export type ReconcileJob =
  | { type: 'expire_reservations' }
  | { type: 'reconcile_payments' }
  | { type: 'bulk_refund'; eventId: string; initiatedBy: string };

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 86_400 },
};

export const emailQueue = new Queue<EmailJob>(QUEUE_NAMES.EMAIL, {
  connection: queueConnection(),
  defaultJobOptions,
});

export const mediaQueue = new Queue<MediaJob>(QUEUE_NAMES.MEDIA, {
  connection: queueConnection(),
  defaultJobOptions,
});

export const reconcileQueue = new Queue<ReconcileJob>(QUEUE_NAMES.RECONCILE, {
  connection: queueConnection(),
  defaultJobOptions,
});

export const ALL_QUEUES = [emailQueue, mediaQueue, reconcileQueue];

// --------------------------------------------------------------- enqueueing

/**
 * The slice of Queue the enqueue helpers need. Structural rather than
 * `Queue<T>`: BullMQ derives its job-name type through a conditional that TS
 * cannot resolve while the data type is still a type parameter.
 */
type Enqueueable<T> = {
  readonly name: string;
  add(name: string, data: T, opts?: JobsOptions): Promise<unknown>;
};

/**
 * Post-commit notifications (R5). The money is already banked and the tickets
 * already exist by the time this runs, so a Redis blip must not turn a
 * successful purchase into an error the buyer sees (F14: "never lose a payment
 * because Redis blinked"). The drop is logged loudly instead.
 *
 * Job payloads are never logged — they can carry identifiers we do not want in
 * log storage (§8).
 */
export async function enqueueBestEffort<T>(
  queue: Enqueueable<T>,
  name: string,
  data: T,
  opts?: JobsOptions,
): Promise<boolean> {
  try {
    await queue.add(name, data, opts);
    return true;
  } catch (err) {
    logger.error(
      { err: (err as Error).message, queue: queue.name, job: name },
      'enqueue failed — job dropped',
    );
    return false;
  }
}

/**
 * Work that must not be silently lost. Fails CLOSED (F14): the caller gets
 * UPSTREAM_UNAVAILABLE and can retry, rather than believing the job is queued.
 */
export async function enqueueRequired<T>(
  queue: Enqueueable<T>,
  name: string,
  data: T,
  opts?: JobsOptions,
): Promise<void> {
  try {
    await queue.add(name, data, opts);
  } catch (err) {
    logger.error(
      { err: (err as Error).message, queue: queue.name, job: name },
      'required enqueue failed',
    );
    throw new AppError('UPSTREAM_UNAVAILABLE', {
      message: 'Background processing is unavailable. Please retry.',
      cause: err,
    });
  }
}

/**
 * Deterministic job ids. BullMQ refuses a second job with an id it already
 * holds, which is a cheap second layer of de-duplication behind the real one:
 * the idempotency gate inside confirmPayment (R3).
 *
 * The separator is `.`, not `:` — BullMQ builds its Redis keys around colons
 * and rejects a custom id containing one.
 */
export const jobIds = {
  ticketConfirmation: (paymentId: string) => `ticket-confirmation.${paymentId}`,
  refundIssued: (refundId: string) => `refund-issued.${refundId}`,
  eventCancelled: (eventId: string) => `event-cancelled.${eventId}`,
  bulkRefund: (eventId: string) => `bulk-refund.${eventId}`,
};

// -------------------------------------------------------------- schedules

/**
 * Recurring work (§7.6). `every` is in milliseconds.
 *
 * Registered by whoever runs the workers, never at import time — a test suite
 * or a one-off script that imports a service must not silently start
 * scheduling background jobs.
 */
export const SCHEDULES = [
  { id: 'expire-reservations', queue: reconcileQueue, every: 60_000, data: { type: 'expire_reservations' } },
  { id: 'reconcile-payments', queue: reconcileQueue, every: 300_000, data: { type: 'reconcile_payments' } },
  { id: 'cleanup-orphaned-uploads', queue: mediaQueue, every: 86_400_000, data: { type: 'cleanup_orphaned_uploads' } },
] as const;

export async function registerSchedules(): Promise<void> {
  for (const schedule of SCHEDULES) {
    // upsert, not add: restarting the API must not accumulate a second copy of
    // every recurring job.
    await (schedule.queue as Queue).upsertJobScheduler(
      schedule.id,
      { every: schedule.every },
      { name: schedule.data.type, data: schedule.data },
    );
  }
  logger.info({ schedules: SCHEDULES.map((s) => s.id) }, 'recurring jobs registered');
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled(ALL_QUEUES.map((q) => q.close()));
}
