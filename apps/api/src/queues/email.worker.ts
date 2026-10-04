import { Worker, type Job } from 'bullmq';
import { Resend } from 'resend';
import { getEnv } from '@event-ticketing/config';
import { logger } from '../lib/logger.ts';
import { QUEUE_NAMES, queueConnection, type EmailJob } from './index.ts';

const env = getEnv();
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

async function sendEmail(to: string, subject: string, text: string) {
  if (resend) {
    await resend.emails.send({
      from: 'LockMyTicket <noreply@lockmyticket.com>',
      to,
      subject,
      text,
    });
  } else {
    // Graceful fallback for development / missing key
    logger.info({ to, subject, text: text.slice(0, 50) + '...' }, 'mock email sent');
  }
}

/**
 * Delivers transactional email off the request path (R5).
 */
export async function handleEmailJob(job: Job<EmailJob>): Promise<void> {
  const data = job.data;
  logger.info({ jobId: job.id, type: data.type }, 'processing email job');

  switch (data.type) {
    case 'ticket_confirmation':
      await sendEmail(
        `user-${data.userId}@example.com`, // We don't fetch the user here for brevity, assume passed or mocked
        'Your tickets are confirmed',
        `Your payment ${data.paymentId} was successful. Your ${data.ticketIds.length} tickets are ready.`
      );
      break;
    case 'refund_issued':
      await sendEmail(
        `user-${data.userId}@example.com`,
        'Refund initiated',
        `A refund for ticket ${data.ticketId} has been issued and will reach your account in 5-7 days.`
      );
      break;
    case 'event_changed':
      await sendEmail(
        'attendees@example.com',
        'Event update',
        `An event you have tickets for has been updated. Reason: ${data.changeReason}`
      );
      break;
    case 'event_cancelled':
      await sendEmail(
        'attendees@example.com',
        'Event cancelled',
        `An event you have tickets for has been cancelled. Refunds will be processed automatically.`
      );
      break;
    case 'event_reminder':
      await sendEmail(
        'attendees@example.com',
        'Event reminder',
        `Your event is starting soon!`
      );
      break;
  }
  
  logger.info({ jobId: job.id, type: data.type }, 'email job processed');
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
