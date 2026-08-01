import { Elysia } from 'elysia';
import type { UserRole, UserStatus } from '@event-ticketing/types';
import { sql } from '../db/transaction.ts';
import { AppError } from '../lib/errors.ts';
import { verifyAccessToken } from '../lib/jwt.ts';

export type AuthUser = {
  id: string;
  role: UserRole;
  status: UserStatus;
};

function bearerToken(authorization: string | null): string {
  if (!authorization?.startsWith('Bearer ')) {
    throw new AppError('UNAUTHENTICATED', { message: 'Missing bearer token.' });
  }
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) throw new AppError('UNAUTHENTICATED', { message: 'Missing bearer token.' });
  return token;
}

/**
 * Verifies the access token and re-reads `users.status` from the database
 * (§8 session revocation): a disabled user's live token stops working on the
 * next request, not 15 minutes later.
 *
 * This is the middleware layer of authorization. RLS is the primary layer
 * (R4) — never rely on this check alone.
 */
export async function authenticate(authorization: string | null): Promise<AuthUser> {
  const claims = await verifyAccessToken(bearerToken(authorization));

  const rows = (await sql`
    select id, role, status from users where id = ${claims.sub}
  `) as Array<{ id: string; role: UserRole; status: UserStatus }>;

  const user = rows[0];
  if (!user) throw new AppError('UNAUTHENTICATED', { message: 'User no longer exists.' });
  if (user.status === 'disabled') throw new AppError('ACCOUNT_DISABLED');

  return { id: user.id, role: user.role, status: user.status };
}

/** Guard for routes requiring any authenticated user. */
export const requireAuth = new Elysia({ name: 'requireAuth' }).derive(
  { as: 'scoped' },
  async ({ headers }) => ({
    user: await authenticate(headers.authorization ?? null),
  }),
);

/**
 * Guard for routes requiring a specific role. Admins satisfy every role
 * requirement; organizer approval is checked separately (Phase 3+), because
 * `ORGANIZER_NOT_APPROVED` is a distinct error from `FORBIDDEN`.
 */
export function requireRole(...roles: UserRole[]) {
  return new Elysia({ name: `requireRole:${roles.join(',')}` }).derive(
    { as: 'scoped' },
    async ({ headers }) => {
      const user = await authenticate(headers.authorization ?? null);
      if (user.role !== 'admin' && !roles.includes(user.role)) {
        throw new AppError('FORBIDDEN');
      }
      return { user };
    },
  );
}
