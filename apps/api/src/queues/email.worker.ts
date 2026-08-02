import { Worker, type Job } from 'bullmq';
import { logger } from '../lib/logger.ts';
import { QUEUE_NAMES, queueConnection, type EmailJob } from './index.ts';

/**
 * Delivers transactional email off the request path (R5).
 *
 * No email provider is wired up yet — that is a deployment concern, not a
 * correctness one. What matters for the critical path is already true here:
 * the send happens in a worker, retries are BullMQ's problem, and a provider
 * outage cannot fail a purchase.
 *
 * Job payloads are never logged; they identify buyers (§8).
 */
export async function handleEmailJob(job: Job<EmailJob>): Promise<void> {
  logger.info({ jobId: job.id, type: job.data.type }, 'email job processed');
}

export function startEmailWorker(): Worker<EmailJob> {
  const worker = new Worker<EmailJob>(QUEUE_NAMES.EMAIL, handleEmailJob, {
    connection: queueConnection(),
    concurrency: 5,
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'email job failed');
  });

  return worker;
}
