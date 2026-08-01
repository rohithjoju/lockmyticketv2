import { pino } from 'pino';
import { getEnv } from '@event-ticketing/config';

const env = getEnv();

/**
 * Structured JSON logs (SPEC §9). Never log tokens, password hashes, or
 * Razorpay secrets (§8) — the redact list below is a backstop, not a licence
 * to pass secrets in.
 */
export const logger = pino({
  // LOG_LEVEL lets test runs silence access logs without changing NODE_ENV.
  level: process.env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: [
      'password',
      'passwordHash',
      'password_hash',
      'token',
      'accessToken',
      'refreshToken',
      'qrToken',
      'qr_jwt_token',
      'authorization',
      'req.headers.authorization',
      'req.headers.cookie',
      'razorpaySignature',
      'razorpay_signature',
      '*.password',
      '*.password_hash',
    ],
    censor: '[REDACTED]',
  },
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

export type Logger = typeof logger;

/** Request-scoped child logger. */
export function requestLogger(requestId: string, userId?: string): Logger {
  return logger.child({ requestId, ...(userId ? { userId } : {}) });
}
