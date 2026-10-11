import * as jose from 'jose';
import { getEnv } from '@event-ticketing/config';
import { AppError } from './errors.ts';
import { logger } from './logger.ts';

const env = getEnv();

// Google's public JSON Web Key Set endpoint
const GOOGLE_JWKS_URI = new URL('https://www.googleapis.com/oauth2/v3/certs');
const googleJWKS = jose.createRemoteJWKSet(GOOGLE_JWKS_URI);

export type VerifiedOAuthUser = {
  provider: 'google' | 'apple';
  email: string;
  name: string;
  providerUserId: string;
};

/**
 * Cryptographically verifies a Google ID Token (JWT) issued by Google Identity Services.
 * Validates signature against Google's public JWKS, expiration, audience, and email verification.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedOAuthUser> {
  const googleClientId = env.GOOGLE_CLIENT_ID;

  try {
    const { payload } = await jose.jwtVerify(idToken, googleJWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: googleClientId || undefined,
    });

    if (!payload.email || typeof payload.email !== 'string') {
      throw new AppError('UNAUTHENTICATED', { message: 'Google account has no email address.' });
    }

    if (!payload.email_verified) {
      throw new AppError('UNAUTHENTICATED', { message: 'Google email address is not verified.' });
    }

    const email = payload.email.trim().toLowerCase();
    const name =
      (typeof payload.name === 'string' && payload.name.trim()) ||
      (typeof payload.given_name === 'string' && payload.given_name.trim()) ||
      email.split('@')[0] ||
      'Google User';

    return {
      provider: 'google',
      email,
      name,
      providerUserId: String(payload.sub),
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err: (err as Error).message }, 'Failed to verify Google ID token');
    throw new AppError('UNAUTHENTICATED', {
      message: 'Invalid or expired Google authentication credential.',
    });
  }
}

/**
 * Verifies a Google access_token via Google's official userinfo API.
 */
export async function verifyGoogleAccessToken(accessToken: string): Promise<VerifiedOAuthUser> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Google userinfo HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      given_name?: string;
    };

    if (!data.email) {
      throw new AppError('UNAUTHENTICATED', { message: 'Google account has no email address.' });
    }

    if (!data.email_verified) {
      throw new AppError('UNAUTHENTICATED', { message: 'Google email address is not verified.' });
    }

    const email = data.email.trim().toLowerCase();
    const name = data.name?.trim() || data.given_name?.trim() || email.split('@')[0] || 'Google User';

    return {
      provider: 'google',
      email,
      name,
      providerUserId: data.sub || email,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err: (err as Error).message }, 'Failed to verify Google access token');
    throw new AppError('UNAUTHENTICATED', {
      message: 'Invalid or expired Google authentication token.',
    });
  }
}
