import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { getEnv } from '@event-ticketing/config';
import { closeDatabase } from './db/transaction.ts';
import { closeRedis, connectRedis } from './db/redis.ts';
import { logger } from './lib/logger.ts';
import { errorHandlerPlugin } from './middleware/errorHandler.ts';
import { clientIp, requestIdPlugin } from './middleware/requestId.ts';
import { globalLimit } from './middleware/rateLimit.ts';
import { authRoutes, passwordRoutes } from './routes/auth.routes.ts';
import {
  protectedEventRoutes,
  publicEventRoutes,
  ticketTypeRoutes,
} from './routes/event.routes.ts';
import { adminRoutes } from './routes/admin.routes.ts';
import { healthRoutes } from './routes/health.routes.ts';
import { organizerRoutes } from './routes/organizer.routes.ts';
import { paymentRoutes, paymentWebhookRoutes } from './routes/payment.routes.ts';
import { refundRoutes } from './routes/refund.routes.ts';
import { reservationRoutes, ticketRoutes } from './routes/ticket.routes.ts';
import { closeQueues, registerSchedules } from './queues/index.ts';
import { startEmailWorker } from './queues/email.worker.ts';
import { startMediaWorker } from './queues/media.worker.ts';
import { startReconcileWorker } from './queues/reconcile.worker.ts';

// R11: validates the whole env contract here. A missing var fails boot.
const env = getEnv();

export function createApp() {
  return (
    new Elysia()
      // Order matters: requestId must run before errorHandler so failures
      // still carry a correlation id into the envelope (R9).
      .use(requestIdPlugin)
      .use(errorHandlerPlugin)
      .use(
        cors({
          origin: [env.WEB_URL, 'https://zoogleal-consciously-eliseo.ngrok-free.dev'],
          credentials: true,
        }),
      )

      // .use(cors({ origin: env.WEB_URL, credentials: true }))
      // .use(cors({ origin: 'https://zoogleal-consciously-eliseo.ngrok-free.dev', credentials: true }))
      .use(
        swagger({
          path: '/docs',
          documentation: {
            info: { title: 'Event Ticketing API', version: '1.0.0' },
          },
        }),
      )
      .onBeforeHandle(async ({ request, server, path }) => {
        // /health must stay reachable even when a caller is being throttled.
        if (path === '/api/v1/health') return;
        await globalLimit(clientIp(request, server));
      })
      .group('/api/v1', (app) =>
        app
          .use(healthRoutes)
          .use(passwordRoutes)
          .use(authRoutes)
          .use(publicEventRoutes)
          .use(protectedEventRoutes)
          .use(ticketTypeRoutes)
          // Public and HMAC-authenticated: mounted before the guarded /payments
          // instance so it is never behind requireAuth.
          .use(paymentWebhookRoutes)
          .use(paymentRoutes)
          .use(ticketRoutes)
          .use(refundRoutes)
          .use(reservationRoutes)
          .use(organizerRoutes)
          .use(adminRoutes),
      )
  );
}

export type App = ReturnType<typeof createApp>;

// Only listen when run directly, so tests can import createApp() freely — and
// so importing a service never starts a worker or schedules a recurring job.
if (import.meta.main) {
  await connectRedis();

  const workers = [startEmailWorker(), startMediaWorker(), startReconcileWorker()];
  await registerSchedules();

  const app = createApp().listen(env.API_PORT);
  logger.info({ port: env.API_PORT, env: env.NODE_ENV }, 'api listening');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await app.stop();
    // Workers first: let an in-flight confirmation email finish before the
    // database it reads from goes away.
    await Promise.allSettled(workers.map((w) => w.close()));
    await closeQueues();
    await Promise.allSettled([closeDatabase(), closeRedis()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
