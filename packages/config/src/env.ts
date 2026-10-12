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

/** An unset env var and `FOO=` (empty string) are indistinguishable in a shell — treat both as absent. */
const blankAsUndefined = (v: unknown) => (v === '' ? undefined : v);
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankAsUndefined, schema.optional());

const port = z.coerce.number().int().positive().max(65535);
const positiveInt = z.coerce.number().int().positive();

/**
 * Fixed credentials `supabase start` (CLI) prints for every local project.
 * Public, identical on every machine, signed with LOCAL_SUPABASE_JWT_SECRET —
 * never valid against a real project. Used only when SUPABASE_MODE=local and
 * the corresponding env var is left blank.
 */
export const LOCAL_SUPABASE_DEFAULTS = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  SUPABASE_SERVICE_ROLE_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
} as const;

/** The JWT secret baked into every local `supabase start`. Local mode only. */
export const LOCAL_SUPABASE_JWT_SECRET =
  'super-secret-jwt-token-with-at-least-32-characters-long';

const envSchema = z
  .object({
    // ---- Runtime
    NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    API_PORT: port.default(3001),
    WEB_URL: z.string().url(),
    API_URL: z.string().url(),

    // ---- Supabase
    // 'local'  -> talk to `supabase start` (Docker). Blank fields below fall
    //             back to LOCAL_SUPABASE_DEFAULTS, so no real project is needed.
    // 'cloud'  -> talk to a real Supabase project. All fields below become
    //             mandatory; boot fails loudly if any is missing (R11).
    SUPABASE_MODE: z.enum(['local', 'cloud']).default('local'),
    SUPABASE_URL: optional(z.string().url()),
    SUPABASE_ANON_KEY: optional(z.string().min(1)),
    SUPABASE_SERVICE_ROLE_KEY: optional(z.string().min(1)),
    // Direct Postgres — supabase-js cannot do multi-statement transactions (R2).
    DATABASE_URL: optional(
      z
        .string()
        .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string'),
    ),

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

    // ---- OAuth
    GOOGLE_CLIENT_ID: optional(z.string().min(1)),
    GOOGLE_CLIENT_SECRET: optional(z.string().min(1)),

    // ---- Email (Resend)
    RESEND_API_KEY: optional(z.string().min(1)),

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

    // SUPABASE_MODE=cloud has no local fallback — every field is mandatory (R11).
    if (val.SUPABASE_MODE === 'cloud') {
      const required = [
        'SUPABASE_URL',
        'SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'DATABASE_URL',
      ] as const;
      for (const key of required) {
        if (!val[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when SUPABASE_MODE=cloud`,
          });
        }
      }
    }
  })
  .transform((val) => ({
    ...val,
    // SUPABASE_MODE=local: fall back to the fixed `supabase start` credentials
    // (LOCAL_SUPABASE_DEFAULTS) for any field left blank.
    SUPABASE_URL: val.SUPABASE_URL ?? LOCAL_SUPABASE_DEFAULTS.SUPABASE_URL,
    SUPABASE_ANON_KEY: val.SUPABASE_ANON_KEY ?? LOCAL_SUPABASE_DEFAULTS.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY:
      val.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SUPABASE_DEFAULTS.SUPABASE_SERVICE_ROLE_KEY,
    DATABASE_URL: val.DATABASE_URL ?? LOCAL_SUPABASE_DEFAULTS.DATABASE_URL,
  }));

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
