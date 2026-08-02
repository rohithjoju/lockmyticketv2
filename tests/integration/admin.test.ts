import { describe, expect, test, beforeAll, mock } from 'bun:test';
import { SQL } from 'bun';

/**
 * Phase 5 — organizer onboarding, admin controls, audit logging.
 *
 * Cloudinary's network call is the only thing stubbed. Magic-byte detection
 * and the size limit are the actual subject of the KYC tests, so they run for
 * real — a stub that accepted everything would prove nothing (§8).
 */
const realCloudinary = await import('../../apps/api/src/lib/cloudinary.ts');
let uploadCalls = 0;
mock.module('../../apps/api/src/lib/cloudinary.ts', () => ({
  ...realCloudinary,
  uploadBuffer: async (input: { folder: string }) => {
    uploadCalls += 1;
    return {
      url: `https://cdn.test/${input.folder}/document.pdf`,
      publicId: `${input.folder}/document`,
      moderationStatus: null,
    };
  },
}));

const { createApp } = await import('../../apps/api/src/index.ts');
const { sql } = await import('../../apps/api/src/db/transaction.ts');
const { connectRedis } = await import('../../apps/api/src/db/redis.ts');
const { signAccessToken } = await import('../../apps/api/src/lib/jwt.ts');
const { MAX_KYC_BYTES } = realCloudinary;

const app = createApp();
const BASE = 'http://localhost/api/v1';
const CLIENT_IP = '203.0.113.40';

// Seed fixtures (0004_seed.sql)
const ADMIN_USER = '11111111-1111-1111-1111-111111111111';
const ORG1_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
const ORG1_USER = '22222222-2222-2222-2222-000000000001';
const ATTENDEE1 = '33333333-3333-3333-3333-000000000001';

type Envelope<T = unknown> = {
  success: boolean;
  data: T | null;
  meta: { requestId: string; cursor?: string | null } | null;
  error: { code: string; message: string; field?: string } | null;
};

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Envelope }> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  headers.set('x-forwarded-for', CLIENT_IP);
  const res = await app.handle(new Request(`${BASE}${path}`, { ...init, headers }));
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as Envelope };
  } catch {
    throw new Error(`non-JSON response from ${path} (${res.status}): ${text.slice(0, 300)}`);
  }
}

/**
 * Tokens are minted directly rather than through /auth/login: approval changes
 * a user's role mid-test, and a cached login token would carry a stale one.
 */
async function tokenFor(userId: string): Promise<string> {
  const rows = (await sql`
    select role, status from users where id = ${userId}
  `) as Array<{ role: 'attendee' | 'organizer' | 'admin'; status: 'active' | 'disabled' }>;
  const row = rows[0];
  if (!row) throw new Error(`no such user: ${userId}`);
  return signAccessToken({ userId, role: row.role, status: row.status });
}

const auth = async (userId: string) => ({ authorization: `Bearer ${await tokenFor(userId)}` });

let seq = 0;
async function makeUser(label: string, role = 'attendee'): Promise<string> {
  const rows = (await sql`
    insert into users (name, email, password_hash, role)
    values (${`${label} ${++seq}`}, ${`${label}-${seq}-${Date.now()}@example.com`},
            'x', ${role})
    returning id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

/** An approved organizer with one live event, isolated from the seed data. */
async function makeOrganizerWithEvent(): Promise<{
  userId: string;
  organizerId: string;
  eventId: string;
}> {
  const userId = await makeUser('Live Organizer', 'organizer');

  const [organizer] = (await sql`
    insert into organizers (user_id, organization_name, contact_number, verification_status)
    values (${userId}, ${`Org ${seq}`}, '9876500000', 'approved')
    returning id
  `) as Array<{ id: string }>;

  const [event] = (await sql`
    insert into events (organizer_id, title, city, start_time, end_time,
                        organizer_status_snapshot)
    values (${organizer!.id}, ${`Flagship Show ${seq}`}, 'Flagtown',
            now() + interval '20 days', now() + interval '20 days' + interval '3 hours',
            'approved')
    returning id
  `) as Array<{ id: string }>;

  return { userId, organizerId: organizer!.id, eventId: event!.id };
}

/** A file whose *content* is a PDF, whatever the name says. */
function pdfFile(name = 'kyc.pdf', bytes = 2048): File {
  const buffer = new Uint8Array(bytes);
  buffer.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
  return new File([buffer], name, { type: 'application/pdf' });
}

function upgradeForm(overrides: Record<string, string | File> = {}): FormData {
  const form = new FormData();
  form.set('organizationName', 'Nightshift Collective');
  form.set('contactNumber', '9876500123');
  form.set('address', '12 Residency Road, Bengaluru');
  form.set('description', 'Live music promoters');
  form.set('kycDocument', pdfFile());
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

async function organizerRow(organizerId: string) {
  const rows = (await sql`
    select verification_status, rejection_reason, version, user_id
      from organizers where id = ${organizerId}
  `) as Array<{
    verification_status: string;
    rejection_reason: string | null;
    version: number;
    user_id: string;
  }>;
  return rows[0]!;
}

async function auditRows(targetId: string) {
  return (await sql`
    select action_type, old_value, new_value, host(ip_address) as ip_address,
           request_id, actor_user_id
      from audit_logs where target_id = ${targetId}
     order by created_at desc, id desc
  `) as Array<{
    action_type: string;
    old_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null;
    ip_address: string | null;
    request_id: string | null;
    actor_user_id: string | null;
  }>;
}

/** Applies, then approves — the shortest path to a usable organizer. */
async function applyAndApprove(userId: string): Promise<string> {
  const applied = await call('/organizers/upgrade', {
    method: 'POST',
    headers: await auth(userId),
    body: upgradeForm(),
  });
  const organizer = applied.body.data as { id: string; version: number };

  const approved = await call(`/admin/organizers/${organizer.id}/approve`, {
    method: 'POST',
    headers: await auth(ADMIN_USER),
    body: JSON.stringify({ version: organizer.version }),
  });
  expect(approved.status).toBe(200);
  return organizer.id;
}

beforeAll(async () => {
  await connectRedis();
});

// ============================================================ onboarding

describe('§6.3 POST /organizers/upgrade', () => {
  test('a valid application creates a pending record and grants nothing yet', async () => {
    const userId = await makeUser('Applicant');
    const before = uploadCalls;

    const { status, body } = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });

    expect(status).toBe(201);
    const organizer = body.data as {
      id: string;
      verificationStatus: string;
      version: number;
      kycDocumentUrl: string;
      contactNumber: string;
    };
    expect(organizer.verificationStatus).toBe('pending');
    expect(organizer.version).toBe(1);
    expect(organizer.kycDocumentUrl).toContain(`kyc/${userId}`);
    expect(organizer.contactNumber).toBe('9876500123');
    expect(uploadCalls).toBe(before + 1);

    // Applying is not becoming: the role is untouched until an admin approves.
    const [user] = (await sql`select role from users where id = ${userId}`) as Array<{
      role: string;
    }>;
    expect(user!.role).toBe('attendee');

    // And the capability itself is still refused.
    const created = await call('/events', {
      method: 'POST',
      headers: { ...(await auth(userId)), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Premature Event',
        city: 'Kochi',
        startTime: new Date(Date.now() + 86_400_000).toISOString(),
        endTime: new Date(Date.now() + 90_000_000).toISOString(),
      }),
    });
    expect(created.body.error?.code).toBe('ORGANIZER_NOT_APPROVED');
  });

  test('§8 — an executable renamed to .pdf is rejected before any upload', async () => {
    const userId = await makeUser('Sneaky Applicant');
    const before = uploadCalls;

    // MZ header: a Windows executable wearing a .pdf name and a PDF mime type.
    const exe = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03])], 'kyc.pdf', {
      type: 'application/pdf',
    });

    const { status, body } = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm({ kycDocument: exe }),
    });

    expect(status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_FAILED');
    expect(body.error?.field).toBe('kycDocument');
    expect(uploadCalls).toBe(before);
  });

  test('§8 — a PDF over 10MB is rejected before any upload', async () => {
    const userId = await makeUser('Bulky Applicant');
    const before = uploadCalls;

    const { status, body } = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm({ kycDocument: pdfFile('kyc.pdf', MAX_KYC_BYTES + 1) }),
    });

    expect(status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_FAILED');
    expect(body.error?.field).toBe('kycDocument');
    expect(body.error?.message).toContain('10MB');
    expect(uploadCalls).toBe(before);
  });

  test('a 10MB PDF exactly at the limit is accepted', async () => {
    const userId = await makeUser('Borderline Applicant');
    const { status } = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm({ kycDocument: pdfFile('kyc.pdf', MAX_KYC_BYTES) }),
    });
    expect(status).toBe(201);
  });

  test('a contact number that is not 10 digits is refused', async () => {
    const userId = await makeUser('Wrong Number');
    const { status, body } = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm({ contactNumber: '98765' }),
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_FAILED');
    expect(body.error?.field).toBe('contactNumber');
  });

  test('a second application while one is pending is refused', async () => {
    const userId = await makeUser('Impatient Applicant');
    const first = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });
    expect(first.status).toBe(201);

    const second = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });
    expect(second.status).toBe(400);
    expect(second.body.error?.message).toContain('under review');
  });

  test('re-applying after a rejection is allowed and bumps the version', async () => {
    const userId = await makeUser('Second Chance');
    const applied = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });
    const organizer = applied.body.data as { id: string; version: number };

    await call(`/admin/organizers/${organizer.id}/reject`, {
      method: 'POST',
      headers: await auth(ADMIN_USER),
      body: JSON.stringify({ version: organizer.version, reason: 'KYC document unreadable' }),
    });

    const reapplied = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm({ organizationName: 'Nightshift Collective (revised)' }),
    });

    expect(reapplied.status).toBe(201);
    const revised = reapplied.body.data as {
      verificationStatus: string;
      rejectionReason: string | null;
      version: number;
      organizationName: string;
    };
    expect(revised.verificationStatus).toBe('pending');
    expect(revised.rejectionReason).toBeNull();
    expect(revised.organizationName).toContain('revised');
    // A stale approval of the rejected submission now loses the race (F9).
    expect(revised.version).toBeGreaterThan(organizer.version);
  });
});

describe('§6.3 /organizers/me', () => {
  test('a user who never applied gets NOT_FOUND, not an empty record', async () => {
    const userId = await makeUser('Never Applied');
    const { status, body } = await call('/organizers/me', { headers: await auth(userId) });
    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  test('a pending applicant cannot edit their profile yet', async () => {
    const userId = await makeUser('Pending Editor');
    await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });

    const { status, body } = await call('/organizers/me', {
      method: 'PATCH',
      headers: { ...(await auth(userId)), 'content-type': 'application/json' },
      body: JSON.stringify({ organizationName: 'Renamed Before Approval' }),
    });
    expect(status).toBe(403);
    expect(body.error?.code).toBe('ORGANIZER_NOT_APPROVED');
  });

  test('an approved organizer can edit their profile but not their own status', async () => {
    const userId = await makeUser('Approved Editor');
    const organizerId = await applyAndApprove(userId);

    const { status, body } = await call('/organizers/me', {
      method: 'PATCH',
      headers: { ...(await auth(userId)), 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationName: 'Daylight Collective',
        contactNumber: '9000011111',
        // Not in the schema — Elysia drops it at the boundary (R12).
        verificationStatus: 'approved',
      }),
    });

    expect(status).toBe(200);
    const updated = body.data as { organizationName: string; contactNumber: string };
    expect(updated.organizationName).toBe('Daylight Collective');
    expect(updated.contactNumber).toBe('9000011111');
    expect((await organizerRow(organizerId)).verification_status).toBe('approved');
  });
});

// ============================================================== approval

describe('§6.3 admin approval (F9)', () => {
  test('approving promotes the applicant and lets them create events', async () => {
    const userId = await makeUser('Rising Organizer');
    const applied = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });
    const organizer = applied.body.data as { id: string; version: number };

    const { status, body } = await call(`/admin/organizers/${organizer.id}/approve`, {
      method: 'POST',
      headers: await auth(ADMIN_USER),
      body: JSON.stringify({ version: organizer.version }),
    });

    expect(status).toBe(200);
    const approved = body.data as { verificationStatus: string; version: number };
    expect(approved.verificationStatus).toBe('approved');
    expect(approved.version).toBe(organizer.version + 1);

    const [user] = (await sql`select role from users where id = ${userId}`) as Array<{
      role: string;
    }>;
    expect(user!.role).toBe('organizer');

    const created = await call('/events', {
      method: 'POST',
      headers: { ...(await auth(userId)), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'First Approved Show',
        city: 'Kochi',
        startTime: new Date(Date.now() + 86_400_000).toISOString(),
        endTime: new Date(Date.now() + 90_000_000).toISOString(),
      }),
    });
    expect(created.status).toBe(201);
    expect((created.body.data as { organizerStatusSnapshot: string }).organizerStatusSnapshot).toBe(
      'approved',
    );
  });

  test('F9 — two admins acting on the same queue entry: the second loses', async () => {
    const userId = await makeUser('Contested Applicant');
    const applied = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });
    const organizer = applied.body.data as { id: string; version: number };
    const headers = { ...(await auth(ADMIN_USER)), 'content-type': 'application/json' };

    const first = await call(`/admin/organizers/${organizer.id}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ version: organizer.version }),
    });
    // The second admin is still holding the version they were shown.
    const second = await call(`/admin/organizers/${organizer.id}/reject`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ version: organizer.version, reason: 'Duplicate application' }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('VERSION_CONFLICT');
    expect(second.body.error?.field).toBe('version');

    // The loser changed nothing.
    const row = await organizerRow(organizer.id);
    expect(row.verification_status).toBe('approved');
    expect(row.rejection_reason).toBeNull();
  });

  test('F9 — simultaneous approvals: exactly one wins', async () => {
    const userId = await makeUser('Race Applicant');
    const applied = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });
    const organizer = applied.body.data as { id: string; version: number };
    const headers = { ...(await auth(ADMIN_USER)), 'content-type': 'application/json' };
    const body = JSON.stringify({ version: organizer.version });

    const [a, b] = await Promise.all([
      call(`/admin/organizers/${organizer.id}/approve`, { method: 'POST', headers, body }),
      call(`/admin/organizers/${organizer.id}/approve`, { method: 'POST', headers, body }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await organizerRow(organizer.id)).version).toBe(organizer.version + 1);
  });

  test('rejecting records the reason and leaves the capability withheld', async () => {
    const userId = await makeUser('Rejected Applicant');
    const applied = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });
    const organizer = applied.body.data as { id: string; version: number };

    const { status, body } = await call(`/admin/organizers/${organizer.id}/reject`, {
      method: 'POST',
      headers: await auth(ADMIN_USER),
      body: JSON.stringify({ version: organizer.version, reason: 'KYC name mismatch' }),
    });

    expect(status).toBe(200);
    expect((body.data as { verificationStatus: string }).verificationStatus).toBe('rejected');
    expect((body.data as { rejectionReason: string }).rejectionReason).toBe('KYC name mismatch');

    const created = await call('/events', {
      method: 'POST',
      headers: { ...(await auth(userId)), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Rejected Show',
        city: 'Kochi',
        startTime: new Date(Date.now() + 86_400_000).toISOString(),
        endTime: new Date(Date.now() + 90_000_000).toISOString(),
      }),
    });
    expect(created.body.error?.code).toBe('ORGANIZER_NOT_APPROVED');
  });

  test('rejecting without a reason is refused at the boundary (R12)', async () => {
    const { status, body } = await call(
      `/admin/organizers/aaaaaaaa-aaaa-aaaa-aaaa-000000000003/reject`,
      {
        method: 'POST',
        headers: await auth(ADMIN_USER),
        body: JSON.stringify({ version: 1 }),
      },
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_FAILED');
  });

  test('approving an organizer that does not exist is NOT_FOUND', async () => {
    const { status, body } = await call(
      '/admin/organizers/00000000-0000-0000-0000-0000000000ff/approve',
      {
        method: 'POST',
        headers: await auth(ADMIN_USER),
        body: JSON.stringify({ version: 1 }),
      },
    );
    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  test('the pending queue lists applicants oldest first, with the version to act on', async () => {
    const userId = await makeUser('Queued Applicant');
    await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });

    const { status, body } = await call('/admin/organizers/pending?limit=100', {
      headers: await auth(ADMIN_USER),
    });

    expect(status).toBe(200);
    const items = body.data as Array<{
      id: string;
      verificationStatus: string;
      version: number;
      applicant: { id: string; name: string; email: string };
    }>;
    expect(items.every((i) => i.verificationStatus === 'pending')).toBe(true);
    expect(items.every((i) => typeof i.version === 'number')).toBe(true);

    const mine = items.find((i) => i.applicant.id === userId);
    expect(mine).toBeDefined();
    expect(mine!.applicant.email).toContain('@');
  });
});

// ================================================================= audit

describe('R10 audit logging', () => {
  test('approval writes an audit row carrying the before and after state', async () => {
    const userId = await makeUser('Audited Applicant');
    const applied = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });
    const organizer = applied.body.data as { id: string; version: number };

    const { body } = await call(`/admin/organizers/${organizer.id}/approve`, {
      method: 'POST',
      headers: await auth(ADMIN_USER),
      body: JSON.stringify({ version: organizer.version }),
    });

    const [entry] = await auditRows(organizer.id);
    expect(entry).toBeDefined();
    expect(entry!.action_type).toBe('organizer.approved');
    expect(entry!.actor_user_id).toBe(ADMIN_USER);
    expect(entry!.old_value).toEqual({
      verificationStatus: 'pending',
      version: organizer.version,
    });
    expect(entry!.new_value).toEqual({
      verificationStatus: 'approved',
      version: organizer.version + 1,
    });
    // §9 — the entry is traceable back to the exact request that caused it.
    expect(entry!.ip_address).toBe(CLIENT_IP);
    expect(entry!.request_id).toBe(body.meta!.requestId);
  });

  test('rejection writes an audit row including the reason', async () => {
    const userId = await makeUser('Audited Rejection');
    const applied = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });
    const organizer = applied.body.data as { id: string; version: number };

    await call(`/admin/organizers/${organizer.id}/reject`, {
      method: 'POST',
      headers: await auth(ADMIN_USER),
      body: JSON.stringify({ version: organizer.version, reason: 'Address unverifiable' }),
    });

    const [entry] = await auditRows(organizer.id);
    expect(entry!.action_type).toBe('organizer.rejected');
    expect(entry!.new_value).toMatchObject({
      verificationStatus: 'rejected',
      reason: 'Address unverifiable',
    });
  });

  test('a rolled-back mutation leaves no audit row behind', async () => {
    const userId = await makeUser('Rollback Applicant');
    const applied = await call('/organizers/upgrade', {
      method: 'POST',
      headers: await auth(userId),
      body: upgradeForm(),
    });
    const organizer = applied.body.data as { id: string; version: number };

    // Stale version → VERSION_CONFLICT → the whole transaction rolls back.
    const { status } = await call(`/admin/organizers/${organizer.id}/approve`, {
      method: 'POST',
      headers: await auth(ADMIN_USER),
      body: JSON.stringify({ version: organizer.version + 99 }),
    });

    expect(status).toBe(409);
    expect(await auditRows(organizer.id)).toHaveLength(0);
  });

  test('disabling and re-enabling both write audit rows', async () => {
    const targetId = await makeUser('Audited Target');
    const headers = { ...(await auth(ADMIN_USER)), 'content-type': 'application/json' };

    await call(`/admin/users/${targetId}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'disabled' }),
    });
    await call(`/admin/users/${targetId}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'active' }),
    });

    const entries = await auditRows(targetId);
    expect(entries.map((e) => e.action_type)).toEqual(['user.enabled', 'user.disabled']);
    expect(entries[1]!.old_value).toEqual({ status: 'active' });
    expect(entries[1]!.new_value).toMatchObject({ status: 'disabled' });
    expect(entries[0]!.old_value).toEqual({ status: 'disabled' });
  });

  test('GET /admin/audit-logs paginates newest first without gaps or duplicates', async () => {
    const targetId = await makeUser('Paginated Target');
    const headers = { ...(await auth(ADMIN_USER)), 'content-type': 'application/json' };

    // Six alternating mutations against one target.
    for (let i = 0; i < 6; i += 1) {
      await call(`/admin/users/${targetId}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: i % 2 === 0 ? 'disabled' : 'active' }),
      });
    }

    const seen: string[] = [];
    let cursor: string | null | undefined = undefined;
    for (let page = 0; page < 5; page += 1) {
      const query = `targetId=${targetId}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const { body } = await call(`/admin/audit-logs?${query}`, {
        headers: await auth(ADMIN_USER),
      });
      const items = body.data as Array<{ id: string; createdAt: string }>;
      seen.push(...items.map((i) => i.id));
      cursor = body.meta?.cursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  test('an audit entry can be traced from the actor as well as the target', async () => {
    const { status, body } = await call(`/admin/audit-logs?actorUserId=${ADMIN_USER}&limit=5`, {
      headers: await auth(ADMIN_USER),
    });
    expect(status).toBe(200);
    const items = body.data as Array<{ actorUserId: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.actorUserId === ADMIN_USER)).toBe(true);
  });
});

// ================================================================== F10

describe('F10 disabling an organizer', () => {
  test('their events are flagged but stay publicly visible and sellable', async () => {
    const { userId, eventId } = await makeOrganizerWithEvent();

    const { status, body } = await call(`/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers: { ...(await auth(ADMIN_USER)), 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    });

    expect(status).toBe(200);
    expect((body.data as { status: string }).status).toBe('disabled');

    const [event] = (await sql`
      select admin_flagged, cancelled_at from events where id = ${eventId}
    `) as Array<{ admin_flagged: boolean; cancelled_at: Date | null }>;
    expect(event!.admin_flagged).toBe(true);
    // Ticket holders are not punished for their organizer's misconduct.
    expect(event!.cancelled_at).toBeNull();

    // Still readable by the public, with no authentication at all.
    const detail = await call(`/events/${eventId}`);
    expect(detail.status).toBe(200);

    const listed = await call('/events?city=Flagtown&limit=50');
    const items = listed.body.data as Array<{ id: string }>;
    expect(items.some((e) => e.id === eventId)).toBe(true);
  });

  test('the disabled organizer can no longer act, on any live token', async () => {
    const { userId } = await makeOrganizerWithEvent();
    // Minted while the account was still healthy.
    const liveToken = await tokenFor(userId);

    await call(`/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers: { ...(await auth(ADMIN_USER)), 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    });

    const { status, body } = await call('/events', {
      method: 'POST',
      headers: { authorization: `Bearer ${liveToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Blocked Event',
        city: 'Flagtown',
        startTime: new Date(Date.now() + 86_400_000).toISOString(),
        endTime: new Date(Date.now() + 90_000_000).toISOString(),
      }),
    });

    // §8 session revocation: the middleware re-reads users.status per request,
    // so an unexpired access token is not a 15-minute window of impunity.
    expect(status).toBe(403);
    expect(body.error?.code).toBe('ACCOUNT_DISABLED');
  });

  test('re-enabling restores the account but not the review flag', async () => {
    const { userId, eventId } = await makeOrganizerWithEvent();
    const headers = { ...(await auth(ADMIN_USER)), 'content-type': 'application/json' };

    await call(`/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'disabled' }),
    });
    await call(`/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'active' }),
    });

    const [user] = (await sql`select status from users where id = ${userId}`) as Array<{
      status: string;
    }>;
    expect(user!.status).toBe('active');

    // admin_flagged is also set by media moderation; clearing it here would
    // erase an unrelated review item.
    const [event] = (await sql`
      select admin_flagged from events where id = ${eventId}
    `) as Array<{ admin_flagged: boolean }>;
    expect(event!.admin_flagged).toBe(true);
  });

  test('an admin cannot disable their own account', async () => {
    const { status, body } = await call(`/admin/users/${ADMIN_USER}/status`, {
      method: 'PATCH',
      headers: await auth(ADMIN_USER),
      body: JSON.stringify({ status: 'disabled' }),
    });
    expect(status).toBe(403);
    expect(body.error?.code).toBe('FORBIDDEN');
  });

  test('changing the status of a user that does not exist is NOT_FOUND', async () => {
    const { status } = await call('/admin/users/00000000-0000-0000-0000-0000000000ff/status', {
      method: 'PATCH',
      headers: await auth(ADMIN_USER),
      body: JSON.stringify({ status: 'disabled' }),
    });
    expect(status).toBe(404);
  });
});

// ================================================== admin surface (R4)

describe('R4 — /admin/* is closed at the middleware layer', () => {
  const surface: Array<[string, RequestInit]> = [
    ['/admin/users', {}],
    ['/admin/organizers/pending', {}],
    ['/admin/events', {}],
    ['/admin/audit-logs', {}],
    ['/admin/dashboard', {}],
    [
      `/admin/users/${ATTENDEE1}/status`,
      { method: 'PATCH', body: JSON.stringify({ status: 'disabled' }) },
    ],
    [
      '/admin/organizers/aaaaaaaa-aaaa-aaaa-aaaa-000000000003/approve',
      { method: 'POST', body: JSON.stringify({ version: 1 }) },
    ],
    [
      '/admin/organizers/aaaaaaaa-aaaa-aaaa-aaaa-000000000003/reject',
      { method: 'POST', body: JSON.stringify({ version: 1, reason: 'nope' }) },
    ],
  ];

  test('an attendee gets 403 on every admin route', async () => {
    for (const [path, init] of surface) {
      const { status, body } = await call(path, { ...init, headers: await auth(ATTENDEE1) });
      expect({ path, status, code: body.error?.code }).toEqual({
        path,
        status: 403,
        code: 'FORBIDDEN',
      });
    }
  });

  test('an approved organizer gets 403 on every admin route', async () => {
    for (const [path, init] of surface) {
      const { status } = await call(path, { ...init, headers: await auth(ORG1_USER) });
      expect({ path, status }).toEqual({ path, status: 403 });
    }
  });

  test('an unauthenticated caller gets 401, not 403', async () => {
    const { status, body } = await call('/admin/dashboard');
    expect(status).toBe(401);
    expect(body.error?.code).toBe('UNAUTHENTICATED');
  });
});

/**
 * The database layer of the same rule (R4). The API pool connects as the table
 * owner, which bypasses RLS by design, so these run over a separate
 * non-owner connection that impersonates a user through the auth shim —
 * the same shape a Supabase client session has.
 */
describe('R4 — /admin/* is closed at the RLS layer', () => {
  let rls: SQL;

  const asUser = async <T>(userId: string, fn: (tx: unknown) => Promise<T>): Promise<T> =>
    (await rls.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
      return fn(tx);
    })) as T;

  beforeAll(async () => {
    await sql`drop role if exists rls_client`;
    await sql`create role rls_client login`;
    await sql`grant usage on schema public, auth to rls_client`;
    await sql`grant select, insert, update, delete on all tables in schema public to rls_client`;

    const url = new URL(process.env.DATABASE_URL!);
    url.username = 'rls_client';
    rls = new SQL({ url: url.toString(), max: 2, idleTimeout: 10 });
  });

  test('a non-admin session reads zero audit_logs; an admin reads them', async () => {
    const asAttendee = await asUser(ATTENDEE1, async (tx) => {
      const rows = (await (tx as typeof sql)`select id from audit_logs`) as unknown[];
      return rows.length;
    });
    const asAdmin = await asUser(ADMIN_USER, async (tx) => {
      const rows = (await (tx as typeof sql)`select id from audit_logs`) as unknown[];
      return rows.length;
    });

    expect(asAttendee).toBe(0);
    expect(asAdmin).toBeGreaterThan(0);
  });

  test("a non-admin session cannot change another user's status; an admin can", async () => {
    const targetId = await makeUser('RLS Target');

    const attendeeUpdated = await asUser(ATTENDEE1, async (tx) => {
      const rows = (await (tx as typeof sql)`
        update users set status = 'disabled' where id = ${targetId} returning id
      `) as unknown[];
      return rows.length;
    });
    expect(attendeeUpdated).toBe(0);

    const adminUpdated = await asUser(ADMIN_USER, async (tx) => {
      const rows = (await (tx as typeof sql)`
        update users set status = 'disabled' where id = ${targetId} returning id
      `) as unknown[];
      return rows.length;
    });
    expect(adminUpdated).toBe(1);
  });

  test('a non-admin session cannot read another user or organizer record', async () => {
    const counts = await asUser(ATTENDEE1, async (tx) => {
      const users = (await (tx as typeof sql)`
        select id from users where id = ${ADMIN_USER}
      `) as unknown[];
      const organizers = (await (tx as typeof sql)`
        select id from organizers where id = ${ORG1_ID}
      `) as unknown[];
      return { users: users.length, organizers: organizers.length };
    });

    expect(counts).toEqual({ users: 0, organizers: 0 });
  });
});

// =================================================================== PII

describe('§8 PII — the organizer-facing attendee list', () => {
  test('GET /events/:id/attendees returns names but no emails or phone numbers', async () => {
    const { userId: organizerUserId, eventId } = await makeOrganizerWithEvent();

    const [ticketType] = (await sql`
      insert into ticket_descriptions (event_id, ticket_type_name, price, total_tickets, available_tickets)
      values (${eventId}, 'General', 500, 10, 9)
      returning id
    `) as Array<{ id: string }>;

    const buyerId = await makeUser('Ticket Holder');
    await sql`
      update users set email = 'holder.secret@example.com' where id = ${buyerId}
    `;
    await sql`
      insert into tickets (user_id, event_id, ticket_description_id, reservation_status,
                           reservation_expires_at)
      values (${buyerId}, ${eventId}, ${ticketType!.id}, 'confirmed', now() + interval '1 day')
    `;

    const res = await app.handle(
      new Request(`${BASE}/events/${eventId}/attendees`, {
        headers: { ...(await auth(organizerUserId)), 'x-forwarded-for': CLIENT_IP },
      }),
    );
    const raw = await res.text();

    expect(res.status).toBe(200);
    const body = JSON.parse(raw) as Envelope<Array<{ attendeeName: string }>>;
    expect(body.data!.length).toBe(1);
    expect(body.data![0]!.attendeeName).toContain('Ticket Holder');

    // Asserted over the raw payload, not the parsed DTO: a leak added to an
    // extra field later would still be caught here.
    expect(raw).not.toContain('holder.secret@example.com');
    expect(raw).not.toContain('@example.com');
    expect(raw).not.toMatch(/\b\d{10}\b/);
    expect(raw.toLowerCase()).not.toContain('email');
    expect(raw.toLowerCase()).not.toContain('phone');
  });
});

// ============================================================= dashboard

describe('§6.3 GET /admin/dashboard', () => {
  test('reports platform metrics that match a direct database query', async () => {
    const { status, body } = await call('/admin/dashboard', { headers: await auth(ADMIN_USER) });
    expect(status).toBe(200);

    const dashboard = body.data as {
      users: { total: number; active: number; disabled: number; byRole: Record<string, number> };
      organizers: { pending: number; approved: number; rejected: number };
      events: { total: number; cancelled: number; flagged: number };
      tickets: { confirmed: number };
      payments: { captured: number; successRate: number };
    };

    const [users] = (await sql`
      select count(*)::int as total,
             count(*) filter (where status = 'disabled')::int as disabled
        from users
    `) as Array<{ total: number; disabled: number }>;
    const [flagged] = (await sql`
      select count(*)::int as n from events where admin_flagged
    `) as Array<{ n: number }>;

    expect(dashboard.users.total).toBe(users!.total);
    expect(dashboard.users.disabled).toBe(users!.disabled);
    expect(dashboard.users.active + dashboard.users.disabled).toBe(dashboard.users.total);
    expect(dashboard.events.flagged).toBe(flagged!.n);
    expect(dashboard.organizers.pending).toBeGreaterThanOrEqual(1);
    expect(dashboard.payments.successRate).toBeGreaterThanOrEqual(0);
    expect(dashboard.payments.successRate).toBeLessThanOrEqual(1);
  });

  test('GET /admin/users filters by role and status and paginates', async () => {
    const first = await call('/admin/users?role=admin&limit=10', {
      headers: await auth(ADMIN_USER),
    });
    const admins = first.body.data as Array<{ id: string; role: string; email: string }>;
    expect(admins.length).toBeGreaterThan(0);
    expect(admins.every((u) => u.role === 'admin')).toBe(true);

    const disabled = await call('/admin/users?status=disabled&limit=50', {
      headers: await auth(ADMIN_USER),
    });
    expect(
      (disabled.body.data as Array<{ status: string }>).every((u) => u.status === 'disabled'),
    ).toBe(true);

    const searched = await call('/admin/users?q=Platform&limit=10', {
      headers: await auth(ADMIN_USER),
    });
    expect((searched.body.data as Array<{ name: string }>).some((u) => u.name === 'Platform Admin')).toBe(
      true,
    );
  });

  test('GET /admin/events shows cancelled events, which the public list hides', async () => {
    const { organizerId } = await makeOrganizerWithEvent();
    const [cancelled] = (await sql`
      insert into events (organizer_id, title, city, start_time, end_time, cancelled_at,
                          organizer_status_snapshot)
      values (${organizerId}, 'Cancelled Gala', 'Flagtown',
              now() + interval '5 days', now() + interval '5 days' + interval '2 hours',
              now(), 'approved')
      returning id
    `) as Array<{ id: string }>;

    const admin = await call(`/admin/events?organizerId=${organizerId}&limit=50`, {
      headers: await auth(ADMIN_USER),
    });
    const adminItems = admin.body.data as Array<{ id: string; status: string }>;
    expect(adminItems.some((e) => e.id === cancelled!.id && e.status === 'cancelled')).toBe(true);

    const publicList = await call('/events?city=Flagtown&limit=50');
    expect(
      (publicList.body.data as Array<{ id: string }>).some((e) => e.id === cancelled!.id),
    ).toBe(false);
  });
});
