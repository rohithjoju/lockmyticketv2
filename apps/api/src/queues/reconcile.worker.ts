import { Worker, type Job } from 'bullmq';
import { runExpireReservations } from '../jobs/expireReservations.ts';
import { runReconcilePayments } from '../jobs/reconcilePayments.ts';
import { logger } from '../lib/logger.ts';
import { refundEventTickets } from '../services/refund.service.ts';
import { QUEUE_NAMES, queueConnection, type ReconcileJob } from './index.ts';

/**
 * The maintenance worker: reservation expiry, payment reconciliation, and the
 * bulk refunds a cancelled event triggers (F12).
 *
 * Every job here is idempotent, because BullMQ will re-run any of them after a
 * crash and none of them may double-restore a seat or double-refund a ticket.
 */
export async function handleReconcileJob(job: Job<ReconcileJob>): Promise<unknown> {
  switch (job.data.type) {
    case 'expire_reservations':
      return { restored: await runExpireReservations() };

    case 'reconcile_payments':
      return runReconcilePayments();

    case 'bulk_refund':
      return refundEventTickets({
        eventId: job.data.eventId,
        initiatedBy: job.data.initiatedBy,
      });
  }
}

export function startReconcileWorker(): Worker<ReconcileJob> {
  const worker = new Worker<ReconcileJob>(QUEUE_NAMES.RECONCILE, handleReconcileJob, {
    connection: queueConnection(),
    // Serial: two expiry sweeps at once is pointless work, and the DB function
    // already serialises what matters.
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, type: job?.data?.type, err: err.message }, 'reconcile job failed');
  });

  return worker;
}
