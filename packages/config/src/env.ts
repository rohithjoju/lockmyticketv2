import { z } from 'zod';

/**
 * Env contract (SPEC §4.2). Validated with zod at boot; throws on any
 * missing/invalid value (R11 — no secrets in code, fail fast).
 *
 * Boot MUST assert: JWT_SECRET !== QR_JWT_SECRET, both >= 32 chars.
 */

/** Named error so callers/tests can assert on boot failure, not a late crash. */
export class EnvValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(
      `Environment validation failed:\n` + issues.map((i) => `  - ${i}`).join('\n'),
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

const duration = z
  .string()
  .regex(/^\d+(ms|s|m|h|d)$/, 'must be a duration like "15m", "7d", "24h"');

const nonEmpty = (label: string) => z.string().min(1, `${label} is required`);

const port = z.coerce.number().int().positive().max(65535);
const positiveInt = z.coerce.number().int().positive();

const envSchema = z
  .object({
    // ---- Runtime
    NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    API_PORT: port.default(3001),
    WEB_URL: z.string().url(),
    API_URL: z.string().url(),

    // ---- Supabase
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: nonEmpty('SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: nonEmpty('SUPABASE_SERVICE_ROLE_KEY'),
    // Direct Postgres — supabase-js cannot do multi-statement transactions (R2).
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string'),

    // ---- Auth (R8: two distinct secrets)
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    QR_JWT_SECRET: z.string().min(32, 'QR_JWT_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL: duration.default('15m'),
    REFRESH_TOKEN_TTL: duration.default('7d'),
    QR_TOKEN_TTL: duration.default('24h'),

    // ---- Razorpay
    RAZORPAY_KEY_ID: nonEmpty('RAZORPAY_KEY_ID'),
    RAZORPAY_KEY_SECRET: nonEmpty('RAZORPAY_KEY_SECRET'),
    RAZORPAY_WEBHOOK_SECRET: nonEmpty('RAZORPAY_WEBHOOK_SECRET'),

    // ---- Cloudinary
    CLOUDINARY_CLOUD_NAME: nonEmpty('CLOUDINARY_CLOUD_NAME'),
    CLOUDINARY_API_KEY: nonEmpty('CLOUDINARY_API_KEY'),
    CLOUDINARY_API_SECRET: nonEmpty('CLOUDINARY_API_SECRET'),

    // ---- Mapbox
    NEXT_PUBLIC_MAPBOX_TOKEN: nonEmpty('NEXT_PUBLIC_MAPBOX_TOKEN'),

    // ---- Redis
    REDIS_URL: z.string().url(),

    // ---- Business rules (tunable without code change)
    RESERVATION_TTL_MINUTES: positiveInt.default(10),
    MAX_TICKETS_PER_USER_PER_EVENT: positiveInt.default(10),
    LOGIN_MAX_ATTEMPTS: positiveInt.default(5),
    LOGIN_LOCKOUT_MINUTES: positiveInt.default(15),
    API_RATE_LIMIT_PER_MINUTE: positiveInt.default(100),
  })
  .superRefine((val, ctx) => {
    // R8: the two secrets must never be interchangeable.
    if (val.JWT_SECRET && val.QR_JWT_SECRET && val.JWT_SECRET === val.QR_JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['QR_JWT_SECRET'],
        message: 'QR_JWT_SECRET must differ from JWT_SECRET (R8)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Pure validator. Prefer this in tests. Throws EnvValidationError with the
 * full list of problems rather than a single first failure.
 */
export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const key = i.path.join('.') || '(root)';
      return `${key}: ${i.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return parsed.data;
}

let cached: Env | null = null;

/**
 * Eager, memoized accessor. First access validates against process.env and
 * throws on failure — this is the "fail at boot" path (R11).
 */
export function getEnv(): Env {
  if (cached === null) {
    cached = loadEnv();
  }
  return cached;
}

/** Convenience singleton. Importing and using this triggers validation. */
export const env: Env = /* @__PURE__ */ new Proxy({} as Env, {
  get(_t, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});
