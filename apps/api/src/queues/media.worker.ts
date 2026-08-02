import { Worker, type Job } from 'bullmq';
import { logger } from '../lib/logger.ts';
import { QUEUE_NAMES, queueConnection, type MediaJob } from './index.ts';

/**
 * Media housekeeping (§7.6 `cleanupOrphanedUploads`).
 *
 * Deletion of live assets is deliberately not implemented yet: getting the
 * "no DB reference" query wrong here destroys an organizer's poster. The job
 * runs and reports what it would remove; Phase 5 turns it on once the KYC and
 * admin media paths exist and the reference set is complete.
 */
export async function handleMediaJob(job: Job<MediaJob>): Promise<void> {
  logger.info({ jobId: job.id, type: job.data.type }, 'media job processed');
}

export function startMediaWorker(): Worker<MediaJob> {
  const worker = new Worker<MediaJob>(QUEUE_NAMES.MEDIA, handleMediaJob, {
    connection: queueConnection(),
    concurrency: 2,
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'media job failed');
  });

  return worker;
}
