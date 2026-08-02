import { describe, expect, test, beforeAll } from 'bun:test';

// Infrastructure and process.env come from tests/helpers/setup.ts, preloaded
// before this file. App modules are imported dynamically because
// packages/config validates the environment at import time.
const { createApp } = await import('../../apps/api/src/index.ts');
const { sql } = await import('../../apps/api/src/db/transaction.ts');
const { connectRedis } = await import('../../apps/api/src/db/redis.ts');
const { buildEventSearchQuery } = await import('../../apps/api/src/services/event.service.ts');
const { detectFileType, readAndValidate, IMAGE_TYPES, MAX_IMAGE_BYTES } = await import(
  '../../apps/api/src/lib/cloudinary.ts'
);

const app = createApp();
const BASE = 'http://localhost/api/v1';
const CLIENT_IP = '203.0.113.20';

// Seed fixtures (0004_seed.sql)
const ORG1_EVENT = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001'; // Kochi Jazz Night
const ORG2_EVENT = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002'; // Mumbai Tech Summit
const ORG1_USER = '22222222-2222-2222-2222-000000000001';
const ORG1_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
const GENERAL_TICKET = 'cccccccc-cccc-cccc-cccc-000000000001';
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
  // Per-IP limiters (notably /auth/login at 10/min) are shared across test
  // files via one Redis, so each file bills its requests to its own address.
  headers.set('x-forwarded-for', CLIENT_IP);
  const res = await app.handle(new Request(`${BASE}${path}`, { ...init, headers }));
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as Envelope };
  } catch {
    throw new Error(`non-JSON response from ${path} (${res.status}): ${text.slice(0, 300)}`);
  }
}

const tokens = new Map<string, string>();

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const { body } = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'Password123!' }),
  });
  const token = (body.data as { accessToken: string } | null)?.accessToken;
  if (!token) throw new Error(`login failed for ${email}: ${JSON.stringify(body.error)}`);
  tokens.set(email, token);
  return token;
}

const auth = async (email: string) => ({ authorization: `Bearer ${await tokenFor(email)}` });

const futureIso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

beforeAll(async () => {
  await connectRedis();

  // A planner needs a realistic table to choose an index over a scan, so the
  // GIN assertion below is only meaningful against a populated `events`.
  await sql`
    insert into events (organizer_id, title, description, city, start_time, end_time,
                        organizer_status_snapshot)
    select ${ORG1_ID}, 'Filler Event ' || g, 'Generic filler description ' || g, 'Bulkville',
           now() + (g || ' hours')::interval,
           now() + (g || ' hours')::interval + interval '2 hours',
           'approved'
      from generate_series(1, 3000) g
  `;

  // Two events per start_time, so paging also exercises the (start_time, id)
  // tiebreak rather than just a strictly increasing key.
  await sql`
    insert into events (organizer_id, title, description, city, start_time, end_time,
                        organizer_status_snapshot)
    select ${ORG1_ID}, 'Paged Event ' || g, 'Pagination fixture', 'Paginopolis',
           date_trunc('hour', now()) + ((g / 2) || ' days')::interval + interval '400 days',
           date_trunc('hour', now()) + ((g / 2) || ' days')::interval + interval '400 days'
             + interval '2 hours',
           'approved'
      from generate_series(1, 12) g
  `;

  // VACUUM, not just ANALYZE: a GIN index with a full pending list is costed
  // as if every pending page had to be scanned, which makes the planner prefer
  // a sequential scan on a table this small. Flushing it restores the real
  // cost — the same reason production GIN indexes need autovacuum to keep up.
  await sql`vacuum analyze events`;
});

describe('AC1 — full-text search uses search_vector and the GIN index', () => {
  test('GET /events?q=jazz&city=Kochi finds the jazz event', async () => {
    const { status, body } = await call('/events?q=jazz&city=Kochi');
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const items = body.data as Array<{ id: string; title: string }>;
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(ORG1_EVENT);
    expect(items[0]!.title).toBe('Kochi Jazz Night');
  });

  test('the query the API actually runs plans as a GIN index scan, not a seq scan', async () => {
    const { text, params } = buildEventSearchQuery({ q: 'jazz', city: 'Kochi', limit: 20 });
    const rows = (await sql.unsafe(`explain (analyze false) ${text}`, params)) as Array<
      Record<string, string>
    >;
    const plan = rows.map((r) => Object.values(r)[0]).join('\n');

    expect(plan).toContain('idx_events_search');
    expect(plan).not.toMatch(/Seq Scan on events/);
  });

  test('search never falls back to LIKE — an infix substring does not match', async () => {
    // 'zzn' is a substring of "Jazz Night" but not a lexeme; LIKE '%zzn%'
    // would match, a tsquery must not.
    const { body } = await call('/events?q=zzn');
    expect(body.data as unknown[]).toHaveLength(0);
  });

  test('multi-word input is accepted rather than raising a tsquery syntax error', async () => {
    const { status, body } = await call(`/events?q=${encodeURIComponent('jazz night')}`);
    expect(status).toBe(200);
    expect((body.data as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('AC2 — cursor pagination has no duplicates and no gaps', () => {
  test('paging through Paginopolis in pages of 5 reproduces the full set exactly', async () => {
    const expected = (await sql`
      select id from events where city = 'Paginopolis' order by start_time asc, id asc
    `) as Array<{ id: string }>;
    expect(expected).toHaveLength(12);

    const seen: string[] = [];
    let cursor: string | null | undefined = null;

    for (let page = 0; page < 10; page++) {
      const qs = `/events?city=Paginopolis&limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const { status, body }: { status: number; body: Envelope } = await call(qs);
      expect(status).toBe(200);
      seen.push(...(body.data as Array<{ id: string }>).map((e) => e.id));
      cursor = body.meta?.cursor;
      if (!cursor) break;
    }

    expect(new Set(seen).size).toBe(seen.length); // no duplicates
    expect(seen).toEqual(expected.map((e) => e.id)); // no gaps, stable order
  });

  test('a malformed cursor is a validation error, not a 500', async () => {
    const { status, body } = await call('/events?cursor=not-a-cursor');
    expect(status).toBe(400);
    expect(body.error!.code).toBe('VALIDATION_FAILED');
    expect(body.error!.field).toBe('cursor');
  });
});

describe('AC3 — organizer approval gates event creation', () => {
  const draft = () => ({
    title: 'Unapproved Organizer Event',
    city: 'Bengaluru',
    startTime: futureIso(20),
    endTime: futureIso(21),
  });

  test('a pending organizer gets ORGANIZER_NOT_APPROVED', async () => {
    const { status, body } = await call('/events', {
      method: 'POST',
      headers: await auth('org3@example.com'),
      body: JSON.stringify(draft()),
    });
    expect(status).toBe(403);
    expect(body.error!.code).toBe('ORGANIZER_NOT_APPROVED');
  });

  test('a plain attendee gets FORBIDDEN, not the waiting-room message', async () => {
    const { status, body } = await call('/events', {
      method: 'POST',
      headers: await auth('user1@example.com'),
      body: JSON.stringify(draft()),
    });
    expect(status).toBe(403);
    expect(body.error!.code).toBe('FORBIDDEN');
  });

  test('an anonymous caller gets UNAUTHENTICATED', async () => {
    const { status, body } = await call('/events', {
      method: 'POST',
      body: JSON.stringify(draft()),
    });
    expect(status).toBe(401);
    expect(body.error!.code).toBe('UNAUTHENTICATED');
  });
});

describe('AC4 — organizer A cannot modify organizer B’s event', () => {
  test('PATCH across organizers is 403 at the API layer', async () => {
    const { status, body } = await call(`/events/${ORG2_EVENT}`, {
      method: 'PATCH',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({ title: 'Hijacked Summit' }),
    });
    expect(status).toBe(403);
    expect(body.error!.code).toBe('FORBIDDEN');

    const rows = (await sql`select title from events where id = ${ORG2_EVENT}`) as Array<{
      title: string;
    }>;
    expect(rows[0]!.title).toBe('Mumbai Tech Summit');
  });

  test('RLS blocks it independently of the middleware (R4)', async () => {
    // Policies only bind for a non-owner, non-superuser role, so the check
    // runs as a bare grantee impersonating organizer A.
    await sql`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'rls_tester') then
          create role rls_tester nologin;
        end if;
      end $$
    `;
    await sql`grant usage on schema public, auth to rls_tester`;
    await sql`grant select, insert, update, delete on all tables in schema public to rls_tester`;
    await sql`grant execute on all functions in schema public, auth to rls_tester`;

    const blocked = await sql.begin(async (tx) => {
      await tx`set local role rls_tester`;
      await tx.unsafe(`set local request.jwt.claim.sub = '${ORG1_USER}'`);

      const others = (await tx`
        update events set title = 'Hijacked by RLS bypass' where id = ${ORG2_EVENT} returning id
      `) as Array<{ id: string }>;
      const own = (await tx`
        update events set title = 'Kochi Jazz Night' where id = ${ORG1_EVENT} returning id
      `) as Array<{ id: string }>;

      return { others: others.length, own: own.length };
    });

    expect(blocked.others).toBe(0); // policy hid organizer B's row
    expect(blocked.own).toBe(1); // ...but organizer A still owns their own
  });

  test('an admin may patch any event', async () => {
    const { status } = await call(`/events/${ORG2_EVENT}`, {
      method: 'PATCH',
      headers: await auth('admin@example.com'),
      body: JSON.stringify({ eventType: 'conference' }),
    });
    expect(status).toBe(200);
  });
});

describe('AC5 — uploads are validated on magic bytes, not the extension', () => {
  const MZ_EXECUTABLE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  const REAL_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

  test('detectFileType refuses a .exe renamed to .pdf', () => {
    expect(detectFileType(MZ_EXECUTABLE)).toBeNull();
    expect(detectFileType(new Uint8Array([...'%PDF-1.7'].map((c) => c.charCodeAt(0))))).toBe('pdf');
    expect(detectFileType(REAL_PNG)).toBe('png');
  });

  test('readAndValidate rejects the renamed executable and accepts a real PNG', async () => {
    const disguised = new File([MZ_EXECUTABLE], 'kyc-document.pdf', { type: 'application/pdf' });
    await expect(
      readAndValidate(disguised, ['pdf'], MAX_IMAGE_BYTES, 'file'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const good = new File([REAL_PNG], 'poster.png', { type: 'image/png' });
    expect((await readAndValidate(good, IMAGE_TYPES, MAX_IMAGE_BYTES, 'file')).type).toBe('png');
  });

  test('POST /events/:id/media rejects it before contacting Cloudinary', async () => {
    const form = new FormData();
    form.set('slot', 'poster');
    form.set('file', new File([MZ_EXECUTABLE], 'poster.png', { type: 'image/png' }));

    const { status, body } = await call(`/events/${ORG1_EVENT}/media`, {
      method: 'POST',
      headers: await auth('org1@example.com'),
      body: form,
    });

    // 400, not 502: the upload never happened. (Cloudinary credentials here are
    // fake, so a request that reached it would surface as UPSTREAM_UNAVAILABLE.)
    expect(status).toBe(400);
    expect(body.error!.code).toBe('VALIDATION_FAILED');

    const rows = (await sql`select poster_url from events where id = ${ORG1_EVENT}`) as Array<{
      poster_url: string | null;
    }>;
    expect(rows[0]!.poster_url).toBeNull();
  });
});

describe('AC6 — creating an event snapshots the organizer status', () => {
  test('POST /events stores organizer_status_snapshot = approved', async () => {
    const { status, body } = await call('/events', {
      method: 'POST',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({
        title: 'Snapshot Test Event',
        description: 'A perfectly ordinary description.',
        city: 'Kochi',
        startTime: futureIso(45),
        endTime: futureIso(46),
      }),
    });

    expect(status).toBe(201);
    const created = body.data as { id: string; organizerStatusSnapshot: string; status: string };
    expect(created.organizerStatusSnapshot).toBe('approved');
    expect(created.status).toBe('upcoming'); // R7 — computed by the view

    const rows = (await sql`
      select organizer_status_snapshot from events where id = ${created.id}
    `) as Array<{ organizer_status_snapshot: string }>;
    expect(rows[0]!.organizer_status_snapshot).toBe('approved');
  });

  test('refundPolicy round-trips as a jsonb object, not a JSON string', async () => {
    const { body } = await call('/events', {
      method: 'POST',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({
        title: 'Refund Policy Event',
        city: 'Kochi',
        startTime: futureIso(70),
        endTime: futureIso(71),
        refundPolicy: { full_refund_hours: 72, partial_refund_percent: 25 },
      }),
    });

    const created = body.data as { id: string; refundPolicy: Record<string, number> };
    expect(created.refundPolicy).toEqual({ full_refund_hours: 72, partial_refund_percent: 25 });

    // The refund service reads this with a jsonb operator, so it must be an
    // object in the column — a double-encoded string would silently break it.
    const rows = (await sql`
      select jsonb_typeof(refund_policy) as kind,
             (refund_policy ->> 'full_refund_hours')::int as hours
        from events where id = ${created.id}
    `) as Array<{ kind: string; hours: number }>;
    expect(rows[0]!.kind).toBe('object');
    expect(rows[0]!.hours).toBe(72);
  });

  test('end_time before start_time is rejected', async () => {
    const { status, body } = await call('/events', {
      method: 'POST',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({
        title: 'Time Travelling Event',
        city: 'Kochi',
        startTime: futureIso(10),
        endTime: futureIso(9),
      }),
    });
    expect(status).toBe(400);
    expect(body.error!.code).toBe('VALIDATION_FAILED');
  });

  test('§8 XSS — a script tag in the description is stripped before storage', async () => {
    const { body } = await call('/events', {
      method: 'POST',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({
        title: 'Sanitised Event',
        description: '<p>Safe copy</p><script>alert(document.cookie)</script>',
        city: 'Kochi',
        startTime: futureIso(50),
        endTime: futureIso(51),
      }),
    });

    const created = body.data as { id: string; description: string };
    expect(created.description).toBe('<p>Safe copy</p>');

    const rows = (await sql`select description from events where id = ${created.id}`) as Array<{
      description: string;
    }>;
    expect(rows[0]!.description).not.toContain('<script');
  });
});

describe('AC7 — GET /events/:id returns live availability', () => {
  test('detail reflects an inventory change made after the first read', async () => {
    const first = await call(`/events/${ORG1_EVENT}`);
    expect(first.status).toBe(200);

    const before = (first.body.data as { ticketTypes: Array<{ id: string; availableTickets: number }> })
      .ticketTypes.find((t) => t.id === GENERAL_TICKET)!;
    expect(before.availableTickets).toBe(200);

    // R1 — the only legal way to move inventory.
    await sql`select * from reserve_tickets(${ATTENDEE1}::uuid, ${GENERAL_TICKET}::uuid, 3, 10, 10)`;

    const second = await call(`/events/${ORG1_EVENT}`);
    const after = (second.body.data as { ticketTypes: Array<{ id: string; availableTickets: number }> })
      .ticketTypes.find((t) => t.id === GENERAL_TICKET)!;
    expect(after.availableTickets).toBe(197);
  });

  test('an unknown event id is NOT_FOUND, in the envelope', async () => {
    const { status, body } = await call('/events/00000000-0000-0000-0000-0000000000ff');
    expect(status).toBe(404);
    expect(body.error!.code).toBe('NOT_FOUND');
    expect(body.meta?.requestId).toMatch(/^req_/);
  });
});

describe('ticket types (§6.3)', () => {
  let ticketTypeId = '';

  test('an owner can create a ticket type', async () => {
    const { status, body } = await call(`/events/${ORG1_EVENT}/ticket-types`, {
      method: 'POST',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({ name: 'Balcony', price: 1200.5, totalTickets: 40 }),
    });
    expect(status).toBe(201);

    const created = body.data as { id: string; price: number; availableTickets: number };
    ticketTypeId = created.id;
    expect(created.price).toBe(1200.5);
    expect(created.availableTickets).toBe(40);
  });

  test('a non-owner cannot create one', async () => {
    const { status, body } = await call(`/events/${ORG1_EVENT}/ticket-types`, {
      method: 'POST',
      headers: await auth('org2@example.com'),
      body: JSON.stringify({ name: 'Sneaky', price: 1, totalTickets: 1 }),
    });
    expect(status).toBe(403);
    expect(body.error!.code).toBe('FORBIDDEN');
  });

  test('capacity can grow, and availability grows with it', async () => {
    const { status, body } = await call(`/ticket-types/${ticketTypeId}`, {
      method: 'PATCH',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({ totalTickets: 60 }),
    });
    expect(status).toBe(200);
    expect(body.data as { totalTickets: number; availableTickets: number }).toMatchObject({
      totalTickets: 60,
      availableTickets: 60,
    });
  });

  test('capacity cannot be reduced below what is already held', async () => {
    await sql`select * from reserve_tickets(${ATTENDEE1}::uuid, ${ticketTypeId}::uuid, 5, 10, 10)`;

    const { status, body } = await call(`/ticket-types/${ticketTypeId}`, {
      method: 'PATCH',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({ totalTickets: 4 }),
    });
    expect(status).toBe(400);
    expect(body.error!.field).toBe('totalTickets');

    // Reducing to exactly the held count is allowed.
    const shrink = await call(`/ticket-types/${ticketTypeId}`, {
      method: 'PATCH',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({ totalTickets: 5 }),
    });
    expect(shrink.status).toBe(200);
    expect(shrink.body.data as { availableTickets: number }).toMatchObject({
      totalTickets: 5,
      availableTickets: 0,
    });
  });

  test('a ticket type with tickets against it cannot be deleted', async () => {
    const { status } = await call(`/ticket-types/${ticketTypeId}`, {
      method: 'DELETE',
      headers: await auth('org1@example.com'),
    });
    expect(status).toBe(400);
  });

  test('an untouched ticket type can be deleted', async () => {
    const create = await call(`/events/${ORG1_EVENT}/ticket-types`, {
      method: 'POST',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({ name: 'Disposable', price: 10, totalTickets: 5 }),
    });
    const { id } = create.body.data as { id: string };

    const { status } = await call(`/ticket-types/${id}`, {
      method: 'DELETE',
      headers: await auth('org1@example.com'),
    });
    expect(status).toBe(200);

    const rows = (await sql`select 1 from ticket_descriptions where id = ${id}`) as unknown[];
    expect(rows).toHaveLength(0);
  });
});

describe('F11 — editing an event that has sold tickets', () => {
  test('changeReason is required, and the change is audited', async () => {
    const without = await call(`/events/${ORG1_EVENT}`, {
      method: 'PATCH',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({ startTime: futureIso(12), endTime: futureIso(13) }),
    });
    expect(without.status).toBe(400);
    expect(without.body.error!.field).toBe('changeReason');

    const withReason = await call(`/events/${ORG1_EVENT}`, {
      method: 'PATCH',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({
        startTime: futureIso(12),
        endTime: futureIso(13),
        changeReason: 'Venue rescheduled the slot.',
      }),
    });
    expect(withReason.status).toBe(200);

    const audits = (await sql`
      select action_type, new_value from audit_logs
       where target_id = ${ORG1_EVENT} and action_type = 'event.updated_after_sale'
    `) as Array<{ action_type: string; new_value: { changeReason: string } }>;
    expect(audits).toHaveLength(1);
    expect(audits[0]!.new_value.changeReason).toBe('Venue rescheduled the slot.');
  });
});

describe('DELETE /events/:id soft-cancels', () => {
  test('the row survives, cancelled_at is set, and it leaves the public listing', async () => {
    const create = await call('/events', {
      method: 'POST',
      headers: await auth('org1@example.com'),
      body: JSON.stringify({
        title: 'Doomed Event',
        city: 'Cancelville',
        startTime: futureIso(60),
        endTime: futureIso(61),
      }),
    });
    const { id } = create.body.data as { id: string };

    const del = await call(`/events/${id}`, {
      method: 'DELETE',
      headers: await auth('org1@example.com'),
    });
    expect(del.status).toBe(200);
    expect((del.body.data as { status: string; cancelledAt: string | null }).status).toBe(
      'cancelled',
    );

    const rows = (await sql`select cancelled_at from events where id = ${id}`) as Array<{
      cancelled_at: Date | null;
    }>;
    expect(rows[0]!.cancelled_at).not.toBeNull();

    const list = await call('/events?city=Cancelville');
    expect(list.body.data as unknown[]).toHaveLength(0);

    // ...but a ticket holder can still open it.
    const detail = await call(`/events/${id}`);
    expect(detail.status).toBe(200);
  });
});

describe('§8 PII — the attendee list exposes names only', () => {
  test('GET /events/:id/attendees returns no email or phone fields', async () => {
    const { status, body } = await call(`/events/${ORG1_EVENT}/attendees`, {
      headers: await auth('org1@example.com'),
    });
    expect(status).toBe(200);

    const serialized = JSON.stringify(body.data);
    expect(serialized).not.toContain('@example.com');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('phone');
  });

  test('another organizer cannot read the attendee list', async () => {
    const { status } = await call(`/events/${ORG1_EVENT}/attendees`, {
      headers: await auth('org2@example.com'),
    });
    expect(status).toBe(403);
  });
});

describe('GET /events/:id/analytics', () => {
  test('numbers match a direct database query', async () => {
    const { status, body } = await call(`/events/${ORG1_EVENT}/analytics`, {
      headers: await auth('org1@example.com'),
    });
    expect(status).toBe(200);

    const analytics = body.data as { ticketsSold: number; ticketsReserved: number };
    const rows = (await sql`
      select count(*) filter (where reservation_status = 'confirmed')::int as sold,
             count(*) filter (where reservation_status = 'reserved')::int  as reserved
        from tickets where event_id = ${ORG1_EVENT}
    `) as Array<{ sold: number; reserved: number }>;

    expect(analytics.ticketsSold).toBe(rows[0]!.sold);
    expect(analytics.ticketsReserved).toBe(rows[0]!.reserved);
  });
});
