import { getEnv } from '@event-ticketing/config';
import type {
  PublicUserDto,
  SessionUserDto,
  User,
  UserRole,
  UserStatus,
  VerificationStatus,
} from '@event-ticketing/types';
import { redis } from '../db/redis.ts';
import { sql } from '../db/transaction.ts';
import { AppError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../lib/jwt.ts';

const env = getEnv();

export type AuthTokens = { accessToken: string; refreshToken: string };

/** Declared in packages/types (as PublicUserDto) so the web app shares it. */
export type PublicUser = PublicUserDto;

function toPublicUser(row: User): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function issueTokens(user: {
  id: string;
  role: UserRole;
  status: UserStatus;
}): Promise<AuthTokens> {
  const jti = crypto.randomUUID();
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ userId: user.id, role: user.role, status: user.status }),
    signRefreshToken({ userId: user.id, jti }),
  ]);
  return { accessToken, refreshToken };
}

/**
 * Registration always creates an `attendee` (F15). Any `role` in the request
 * body is ignored — role is server-assigned, never client-supplied.
 */
export async function register(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: PublicUser; tokens: AuthTokens }> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  let rows: User[];
  try {
    rows = (await sql`
      insert into users (name, email, password_hash, role)
      values (${input.name.trim()}, ${email}, ${passwordHash}, 'attendee')
      returning *
    `) as User[];
  } catch (err) {
    // 23505 = unique_violation on users.email
    if ((err as { errno?: string; code?: string }).errno === '23505') {
      throw new AppError('EMAIL_ALREADY_EXISTS', { field: 'email' });
    }
    throw err;
  }

  const user = rows[0]!;
  return { user: toPublicUser(user), tokens: await issueTokens(user) };
}

/**
 * Login with lockout (§8): LOGIN_MAX_ATTEMPTS failures lock the account for
 * LOGIN_LOCKOUT_MINUTES. The counter resets on success.
 *
 * Failures are deliberately indistinguishable (unknown email vs wrong
 * password) to avoid account enumeration.
 */
export async function login(input: {
  email: string;
  password: string;
}): Promise<{ user: PublicUser; tokens: AuthTokens }> {
  const email = input.email.trim().toLowerCase();

  const rows = (await sql`
    select * from users where lower(email) = ${email}
  `) as User[];
  const user = rows[0];

  const invalid = new AppError('UNAUTHENTICATED', {
    message: 'Invalid email or password.',
  });

  if (!user) {
    // Spend comparable time so timing doesn't leak whether the email exists.
    await verifyPassword(input.password, '$argon2id$v=19$m=65536,t=2,p=1$AAAA$AAAA');
    throw invalid;
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const retryAfter = Math.ceil(
      (new Date(user.locked_until).getTime() - Date.now()) / 1000,
    );
    throw new AppError('ACCOUNT_LOCKED', {
      headers: { 'retry-after': String(retryAfter) },
    });
  }

  if (user.status === 'disabled') throw new AppError('ACCOUNT_DISABLED');

  const ok = await verifyPassword(input.password, user.password_hash);

  if (!ok) {
    const attempts = user.failed_login_attempts + 1;
    const shouldLock = attempts >= env.LOGIN_MAX_ATTEMPTS;

    await sql`
      update users
         set failed_login_attempts = ${attempts},
             locked_until = ${
               shouldLock
                 ? sql`now() + make_interval(mins => ${env.LOGIN_LOCKOUT_MINUTES})`
                 : null
             }
       where id = ${user.id}
    `;

    if (shouldLock) {
      throw new AppError('ACCOUNT_LOCKED', {
        headers: { 'retry-after': String(env.LOGIN_LOCKOUT_MINUTES * 60) },
      });
    }
    throw invalid;
  }

  // Success resets the throttle.
  await sql`
    update users set failed_login_attempts = 0, locked_until = null where id = ${user.id}
  `;

  return { user: toPublicUser(user), tokens: await issueTokens(user) };
}

/** Redis key for a denylisted refresh token id. */
const denyKey = (jti: string) => `refresh:denied:${jti}`;

/**
 * Rotates a refresh token (§8). The presented token is denylisted for its
 * remaining lifetime, so replaying it fails. Reuse of an already-rotated
 * token is treated as theft and rejected.
 *
 * Redis unavailability fails CLOSED here: without the denylist we cannot
 * guarantee single-use, and silently degrading would weaken session security.
 */
export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const claims = await verifyRefreshToken(refreshToken);

  let denied: string | null;
  try {
    denied = await redis.get(denyKey(claims.jti));
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'refresh denylist unavailable');
    throw new AppError('UNAUTHENTICATED', { message: 'Session store unavailable.' });
  }

  if (denied) {
    logger.warn({ jti: claims.jti, userId: claims.sub }, 'refresh token reuse detected');
    throw new AppError('UNAUTHENTICATED', { message: 'Refresh token already used.' });
  }

  const rows = (await sql`
    select id, role, status from users where id = ${claims.sub}
  `) as Array<{ id: string; role: UserRole; status: UserStatus }>;
  const user = rows[0];
  if (!user) throw new AppError('UNAUTHENTICATED');
  if (user.status === 'disabled') throw new AppError('ACCOUNT_DISABLED');

  await denylistToken(claims.jti);
  return issueTokens(user);
}

/** Denylists a refresh token id until its natural expiry. */
export async function denylistToken(jti: string): Promise<void> {
  const ttlSeconds = parseDurationSeconds(env.REFRESH_TOKEN_TTL);
  await redis.set(denyKey(jti), '1', 'EX', ttlSeconds);
}

/** Logout revokes the presented refresh token. Always succeeds for the user. */
export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  try {
    const claims = await verifyRefreshToken(refreshToken);
    await denylistToken(claims.jti);
  } catch {
    // An invalid or expired token is already unusable — logout is a no-op.
  }
}

/** Current user plus organizer status, for GET /auth/me. */
export async function getMe(userId: string): Promise<SessionUserDto> {
  const rows = (await sql`
    select u.*,
           o.id                  as organizer_id,
           o.verification_status as organizer_verification_status
      from users u
      left join organizers o on o.user_id = u.id
     where u.id = ${userId}
  `) as Array<
    User & { organizer_id: string | null; organizer_verification_status: VerificationStatus | null }
  >;

  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND');

  return {
    ...toPublicUser(row),
    organizer: row.organizer_id
      ? {
          id: row.organizer_id,
          verificationStatus: row.organizer_verification_status!,
        }
      : null,
  };
}

/**
 * Always returns success (§6.3) so the endpoint cannot be used to enumerate
 * accounts. The reset email is enqueued only when the address exists.
 */
export async function forgotPassword(email: string): Promise<void> {
  const rows = (await sql`
    select id from users where lower(email) = ${email.trim().toLowerCase()}
  `) as Array<{ id: string }>;

  const user = rows[0];
  if (!user) return;

  const token = crypto.randomUUID();
  await redis.set(`pwreset:${token}`, user.id, 'EX', 60 * 30);

  // R5: the email itself goes to a queue (wired in Phase 4). Never awaited
  // against a third party inside a request.
  logger.info({ userId: user.id }, 'password reset requested');
}

/** Consumes a reset token exactly once. */
export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<void> {
  const key = `pwreset:${input.token}`;
  const userId = await redis.get(key);
  if (!userId) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'This reset link is invalid or has expired.',
      field: 'token',
    });
  }

  await redis.del(key);
  const passwordHash = await hashPassword(input.password);
  await sql`
    update users
       set password_hash = ${passwordHash},
           failed_login_attempts = 0,
           locked_until = null
     where id = ${userId}
  `;
}

/** "15m" | "7d" | "24h" → seconds. */
function parseDurationSeconds(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) return 7 * 24 * 60 * 60;
  const n = Number(match[1]);
  switch (match[2]) {
    case 'ms':
      return Math.ceil(n / 1000);
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    default:
      return n * 86400;
  }
}
