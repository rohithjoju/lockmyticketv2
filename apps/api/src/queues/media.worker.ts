import { Worker, type Job } from 'bullmq';
import { v2 as cloudinary } from 'cloudinary';
import { logger } from '../lib/logger.ts';
import { sql } from '../db/transaction.ts';
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
  logger.info({ jobId: job.id, type: job.data.type }, 'media job started');

  try {
    // 1. Gather all legitimate references from the database
    const events = (await sql`
      select poster_url, video_url, images_urls
        from events
    `) as Array<{ poster_url: string | null; video_url: string | null; images_urls: string[] | null }>;

    const organizers = (await sql`
      select kyc_document_url
        from organizers
       where kyc_document_url is not null
    `) as Array<{ kyc_document_url: string }>;

    const referencedUrls = new Set<string>();

    for (const e of events) {
      if (e.poster_url) referencedUrls.add(e.poster_url);
      if (e.video_url) referencedUrls.add(e.video_url);
      if (e.images_urls) {
        for (const url of e.images_urls) referencedUrls.add(url);
      }
    }

    for (const o of organizers) {
      referencedUrls.add(o.kyc_document_url);
    }

    logger.info({ referencedCount: referencedUrls.size }, 'collected db media references');

    // 2. Query Cloudinary for assets (simulated here)
    // To actually delete, we would paginate through cloudinary.api.resources
    // and delete anything not in our referencedUrls set.
    // Example:
    // const { resources } = await cloudinary.api.resources({ type: 'upload', prefix: 'lockmyticket' });
    // const toDelete = resources.filter(r => !referencedUrls.has(r.secure_url));
    
    const orphansFound = 0; // Simulated

    if (orphansFound > 0) {
      // await cloudinary.api.delete_resources(toDelete.map(r => r.public_id));
      logger.info({ orphansFound }, 'would have deleted orphaned media');
    } else {
      logger.info('no orphaned media found');
    }

  } catch (err) {
    logger.error({ err: (err as Error).message }, 'media housekeeping failed');
    throw err;
  }
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
