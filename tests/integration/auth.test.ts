import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { startTestEnv, stopTestEnv } from '../helpers/testEnv.ts';

// Boot infra and populate process.env BEFORE importing anything that reads it.
await startTestEnv();

const { createApp } = await import('../../apps/api/src/index.ts');
const { sql } = await import('../../apps/api/src/db/transaction.ts');
const { connectRedis } = await import('../../apps/api/src/db/redis.ts');

const app = createApp();

const BASE = 'http://localhost/api/v1';

type Envelope<T = unknown> = {
  success: boolean;
  data: T | null;
  meta: { requestId: string } | null;
  error: { code: string; message: string; field?: string } | null;
};

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Envelope; headers: Headers }> {
  const res = await app.handle(
    new Request(`${BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    }),
  );
  const text = await res.text();
  let body: Envelope;
  try {
    body = JSON.parse(text) as Envelope;
  } catch {
    throw new Error(`non-JSON response from ${path} (${res.status}): ${text.slice(0, 300)}`);
  }
  return { status: res.status, body, headers: res.headers };
}

/** Asserts the §6.1 envelope shape on any response. */
function expectEnvelope(body: Envelope) {
  expect(body).toHaveProperty('success');
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('meta');
  expect(body).toHaveProperty('error');
  if (body.success) {
    expect(body.error).toBeNull();
  } else {
    expect(body.data).toBeNull();
    expect(body.error).not.toBeNull();
    expect(typeof body.error!.code).toBe('string');
    expect(typeof body.error!.message).toBe('string');
  }
  expect(body.meta?.requestId).toMatch(/^req_/);
}

beforeAll(async () => {
  await connectRedis();
});

afterAll(async () => {
  await sql.close().catch(() => {});
  await stopTestEnv();
});

describe('§6.1 response envelope (R9)', () => {
  test('health returns the envelope', async () => {
    const { status, body } = await call('/health');
    expectEnvelope(body);
    expect(status).toBe(200);
    expect((body.data as { status: string }).status).toBe('ok');
  });

  test('unknown route 404 uses the envelope', async () => {
    const { status, body } = await call('/definitely-not-a-route');
    expect(status).toBe(404);
    expectEnvelope(body);
    expect(body.error!.code).toBe('NOT_FOUND');
  });

  test('schema rejection uses the envelope with VALIDATION_FAILED', async () => {
    const { status, body } = await call('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'x' }), // missing email + password
    });
    expect(status).toBe(400);
    expectEnvelope(body);
    expect(body.error!.code).toBe('VALIDATION_FAILED');
  });

  test('an unhandled throw becomes a 500 envelope that leaks nothing', async () => {
    const boom = createApp().get('/api/v1/boom', () => {
      throw new Error('SECRET_INTERNAL_DETAIL');
    });
    const res = await boom.handle(new Request(`${BASE}/boom`));
    const body = (await res.json()) as Envelope;

    expect(res.status).toBe(500);
    expectEnvelope(body);
    expect(body.error!.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('SECRET_INTERNAL_DETAIL');
  });

  test('every response carries an X-Request-Id header', async () => {
    const { headers } = await call('/health');
    expect(headers.get('x-request-id')).toMatch(/^req_/);
  });
});

describe('register → login → /auth/me round-trip', () => {
  const email = `roundtrip+${Date.now()}@example.com`;

  test('registers a new account', async () => {
    const { status, body } = await call('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Round Trip', email, password: 'Password123!' }),
    });
    expect(status).toBe(201);
    expectEnvelope(body);
    const data = body.data as { user: { email: string; role: string }; accessToken: string };
    expect(data.user.email).toBe(email);
    expect(data.accessToken).toBeTruthy();
  });

  test('duplicate email is rejected with EMAIL_ALREADY_EXISTS', async () => {
    const { status, body } = await call('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Dup', email, password: 'Password123!' }),
    });
    expect(status).toBe(409);
    expect(body.error!.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  test('logs in and reads /auth/me', async () => {
    const login = await call('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'Password123!' }),
    });
    expect(login.status).toBe(200);
    const { accessToken } = login.body.data as { accessToken: string };

    const me = await call('/auth/me', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.status).toBe(200);
    expectEnvelope(me.body);
    const user = me.body.data as { email: string; role: string; organizer: unknown };
    expect(user.email).toBe(email);
    expect(user.role).toBe('attendee');
    expect(user.organizer).toBeNull();
  });

  test('/auth/me without a token is UNAUTHENTICATED', async () => {
    const { status, body } = await call('/auth/me');
    expect(status).toBe(401);
    expect(body.error!.code).toBe('UNAUTHENTICATED');
  });
});

describe('F15 — role is server-assigned', () => {
  test('register with {"role":"admin"} creates an attendee', async () => {
    const email = `escalate+${Date.now()}@example.com`;
    const { status, body } = await call('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Escalator',
        email,
        password: 'Password123!',
        role: 'admin',
      }),
    });
    expect(status).toBe(201);
    expect((body.data as { user: { role: string } }).user.role).toBe('attendee');

    const rows = (await sql`select role from users where email = ${email}`) as Array<{
      role: string;
    }>;
    expect(rows[0]!.role).toBe('attendee');
  });
});

describe('§8 login throttle', () => {
  test('6 bad logins → ACCOUNT_LOCKED with Retry-After', async () => {
    const email = `lockme+${Date.now()}@example.com`;
    await call('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Lock Me', email, password: 'Password123!' }),
    });

    const codes: string[] = [];
    let lockedHeaders: Headers | null = null;

    for (let i = 0; i < 6; i++) {
      const res = await call('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'WrongPassword!' }),
      });
      codes.push(res.body.error!.code);
      if (res.body.error!.code === 'ACCOUNT_LOCKED') lockedHeaders = res.headers;
    }

    // LOGIN_MAX_ATTEMPTS = 5, so the 5th failure locks the account.
    expect(codes).toContain('ACCOUNT_LOCKED');
    expect(lockedHeaders!.get('retry-after')).toBeTruthy();

    // Even the correct password is refused while locked.
    const correct = await call('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'Password123!' }),
    });
    expect(correct.status).toBe(429);
    expect(correct.body.error!.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('§8 refresh rotation + denylist', () => {
  test('using a refresh token twice fails the second time', async () => {
    const email = `rotate+${Date.now()}@example.com`;
    const reg = await call('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Rotator', email, password: 'Password123!' }),
    });

    const setCookie = reg.headers.get('set-cookie') ?? '';
    const refreshToken = /refresh_token=([^;]+)/.exec(setCookie)?.[1];
    expect(refreshToken).toBeTruthy();

    const first = await call('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    });
    expect(first.status).toBe(200);
    expect((first.body.data as { accessToken: string }).accessToken).toBeTruthy();

    // Replaying the same token must fail — it was denylisted on rotation.
    const second = await call('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `refresh_token=${refreshToken}` },
    });
    expect(second.status).toBe(401);
    expect(second.body.error!.code).toBe('UNAUTHENTICATED');
  });
});

describe('§8 session revocation', () => {
  test('disabling a user in the DB → next /auth/me is ACCOUNT_DISABLED', async () => {
    const email = `disable+${Date.now()}@example.com`;
    const reg = await call('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Disable Me', email, password: 'Password123!' }),
    });
    const { accessToken } = reg.body.data as { accessToken: string };

    const before = await call('/auth/me', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(before.status).toBe(200);

    await sql`update users set status = 'disabled' where email = ${email}`;

    // Same still-valid token, but requireAuth re-reads users.status.
    const after = await call('/auth/me', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(after.status).toBe(403);
    expect(after.body.error!.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('§6.3 forgot-password does not enumerate accounts', () => {
  test('unknown email returns 200', async () => {
    const { status, body } = await call('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: `ghost+${Date.now()}@example.com` }),
    });
    expect(status).toBe(200);
    expectEnvelope(body);
    expect(body.success).toBe(true);
  });

  test('known email also returns 200 with an identical body', async () => {
    const known = await call('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'user1@example.com' }),
    });
    const unknown = await call('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody-at-all@example.com' }),
    });
    expect(known.status).toBe(unknown.status);
    expect(known.body.data).toEqual(unknown.body.data);
  });
});

describe('seeded accounts', () => {
  test('seed admin can log in with the documented password', async () => {
    const { status, body } = await call('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@example.com', password: 'Password123!' }),
    });
    expect(status).toBe(200);
    expect((body.data as { user: { role: string } }).user.role).toBe('admin');
  });

  test('seeded organizer /auth/me exposes organizer status', async () => {
    const login = await call('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'org3@example.com', password: 'Password123!' }),
    });
    const { accessToken } = login.body.data as { accessToken: string };

    const me = await call('/auth/me', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const data = me.body.data as {
      organizer: { verificationStatus: string } | null;
    };
    expect(data.organizer?.verificationStatus).toBe('pending');
  });
});
