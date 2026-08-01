import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { getEnv } from '@event-ticketing/config';
import type { UserRole, UserStatus } from '@event-ticketing/types';
import { AppError } from './errors.ts';

const env = getEnv();
const encoder = new TextEncoder();

/**
 * R8 — two separate secrets, never interchanged. Auth tokens and QR tokens
 * are signed with different keys and carry different `typ` claims, so a token
 * of one kind can never be replayed as the other even if a secret leaked.
 */
const AUTH_SECRET = encoder.encode(env.JWT_SECRET);
const QR_SECRET = encoder.encode(env.QR_JWT_SECRET);

const ALG = 'HS256';
const ISSUER = 'event-ticketing';

export type AccessClaims = {
  sub: string;
  role: UserRole;
  status: UserStatus;
  typ: 'access';
};

export type RefreshClaims = {
  sub: string;
  /** Unique token id — the handle used for rotation + Redis denylist (§8). */
  jti: string;
  typ: 'refresh';
};

export type QrClaims = {
  tid: string;
  eid: string;
  nonce: string;
  typ: 'qr';
};

/** Access token: 15m, Bearer. Payload {sub, role, status, iat, exp} (§8). */
export function signAccessToken(input: {
  userId: string;
  role: UserRole;
  status: UserStatus;
}): Promise<string> {
  return new SignJWT({ role: input.role, status: input.status, typ: 'access' })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(AUTH_SECRET);
}

/** Refresh token: 7d, httpOnly cookie, rotated on every use (§8). */
export function signRefreshToken(input: { userId: string; jti: string }): Promise<string> {
  return new SignJWT({ typ: 'refresh' })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setSubject(input.userId)
    .setJti(input.jti)
    .setIssuedAt()
    .setExpirationTime(env.REFRESH_TOKEN_TTL)
    .sign(AUTH_SECRET);
}

/** QR token: QR_JWT_SECRET, 24h, no PII (§7.2). */
export function signQrToken(input: {
  ticketId: string;
  eventId: string;
  nonce: string;
}): Promise<string> {
  return new SignJWT({ tid: input.ticketId, eid: input.eventId, nonce: input.nonce, typ: 'qr' })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(env.QR_TOKEN_TTL)
    .sign(QR_SECRET);
}

async function verify(
  token: string,
  secret: Uint8Array,
  expectedTyp: 'access' | 'refresh' | 'qr',
): Promise<Record<string, unknown>> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
    if (payload.typ !== expectedTyp) {
      throw new AppError('UNAUTHENTICATED', { detail: `expected typ=${expectedTyp}` });
    }
    return payload as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Distinguish expiry so the frontend knows to refresh (§6.2 TOKEN_EXPIRED).
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppError('TOKEN_EXPIRED', { cause: err });
    }
    throw new AppError('UNAUTHENTICATED', { cause: err });
  }
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const p = await verify(token, AUTH_SECRET, 'access');
  return {
    sub: p.sub as string,
    role: p.role as UserRole,
    status: p.status as UserStatus,
    typ: 'access',
  };
}

export async function verifyRefreshToken(token: string): Promise<RefreshClaims> {
  const p = await verify(token, AUTH_SECRET, 'refresh');
  return { sub: p.sub as string, jti: p.jti as string, typ: 'refresh' };
}

export async function verifyQrToken(token: string): Promise<QrClaims> {
  const p = await verify(token, QR_SECRET, 'qr');
  return {
    tid: p.tid as string,
    eid: p.eid as string,
    nonce: p.nonce as string,
    typ: 'qr',
  };
}
