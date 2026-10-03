# SPEC.md — Event Ticketing Platform

**Implementation specification. Version 1.0.**
Stack: Next.js 15 (App Router) · Elysia (Bun) · Supabase (PostgreSQL) · Razorpay · Cloudinary · Mapbox · Redis/BullMQ

> This document is written to be implemented directly by an AI coding agent. Every file path, function signature, error code, and acceptance criterion is specified. Where this document is explicit, follow it exactly. Where it is silent, follow the Global Rules in §2.

---

## §0. THE IMPLEMENTATION PROMPT

Place this file at your repo root as `SPEC.md`, then run:

```bash
mkdir event-ticketing && cd event-ticketing
git init
# copy SPEC.md into this folder
claude
```

Then in Claude Code:

```
/model claude-opus-4-8
/init
```

Then paste:

```
Read @SPEC.md in full before writing any code.

Implement this specification phase by phase, starting with Phase 0.
After completing each phase:
  1. Run that phase's Acceptance Criteria and show me the results
  2. Show me a diff summary
  3. Commit with the exact commit message given in that phase
  4. Stop and wait for my confirmation before starting the next phase

Do not skip ahead. Do not implement phases out of order.
Do not deviate from the Global Rules in §2 of the spec.
If any part of the spec is ambiguous or you believe it is wrong,
stop and ask me rather than guessing.

Begin with Phase 0.
```

To resume in a later session:

```
Read @SPEC.md. We have completed through Phase N.
Verify Phase N's acceptance criteria still pass, then continue with Phase N+1.
```

---

## §1. WHAT WE ARE BUILDING

A multi-tenant event ticketing platform. Three roles:

| Role | Capabilities |
|---|---|
| **Attendee** | Browse/search events, reserve + purchase tickets, view own tickets with QR codes, request refunds |
| **Organizer** | All attendee capabilities, plus: create/manage own events, upload media, define ticket types, scan attendee QR codes at the door, view own-event analytics. **Requires admin approval before creating events.** |
| **Admin** | View/manage all users, approve/reject organizer applications, disable users, view all events, issue refunds, access audit log |

The commercially critical path is: **reserve → pay → confirm → issue QR → scan at door.** Everything in this spec that looks like over-engineering exists to protect that path.

---

## §2. GLOBAL RULES (NON-NEGOTIABLE)

These apply to every phase. Violating any of them is a defect even if tests pass.

**R1 — Inventory is sacred.** Any read of `ticket_descriptions.available_tickets` that leads to a write MUST use `SELECT ... FOR UPDATE` inside a transaction. Never decrement inventory based on a cached or previously-read value.

**R2 — Money operations are transactional.** Payment confirmation, ticket issuance, and inventory changes happen in ONE database transaction. If any step fails, all roll back.

**R3 — Money operations are idempotent.** Any handler that can be invoked twice (webhooks, retried client calls) must produce the same result on the second call as the first, with no duplicate side effects. Idempotency is anchored on `payments.razorpay_payment_id` (UNIQUE constraint).

**R4 — Authorization lives in the database.** Use RLS policies as the primary enforcement. Application-level checks are a second layer, never the only layer.

**R5 — Never block a request on a third party you don't control.** Email, SMS, push notifications, and analytics go to a queue. Only Razorpay verification and Supabase writes may be synchronous.

**R6 — All timestamps are `timestamptz`, stored in UTC.** Convert to local time only at render. Never store a naive timestamp.

**R7 — Event status is computed, never stored.** Derive `upcoming`/`ongoing`/`past` from `start_time`/`end_time` at query time.

**R8 — Two separate JWT secrets.** `JWT_SECRET` for auth tokens. `QR_JWT_SECRET` for ticket QR codes. Never reuse one for the other.

**R9 — Every response uses the envelope in §6.1.** No bare objects, no bare arrays, no inconsistent error shapes.

**R10 — Every admin mutation writes to `audit_logs`.** No exceptions.

**R11 — No secrets in code.** Everything from `process.env`, validated at boot (§4.2). Fail fast on missing vars.

**R12 — Validate at the boundary.** Every route defines an Elysia schema for body/params/query. No unvalidated input reaches business logic.

### Anti-patterns — do NOT do these

| ❌ Don't | ✅ Do instead |
|---|---|
| `if (available > 0) { decrement() }` in app code | Call the `reserve_tickets()` DB function (§5.3) |
| Create tickets in the `/payments/verify` HTTP handler | Call shared `confirmPayment()` used by both verify and webhook |
| Trust `req.body.userId` | Read user identity from the verified JWT only |
| Store `status: 'upcoming'` on events | Use the `events_with_status` view |
| `await sendEmail()` inside a purchase route | `await emailQueue.add(...)` |
| Use `LIKE '%term%'` for search | Use `search_vector @@ to_tsquery(...)` |
| Return `res.status(500).json({msg: e.message})` | Return the envelope with a registered error code (§6.2) |
| Check role only in the frontend | RLS policy + middleware check + frontend guard |

---

## §3. FILE TREE (TARGET STATE)

Create exactly this structure. Do not add extra top-level directories without asking.

```
event-ticketing/
├── SPEC.md                          ← this file
├── CLAUDE.md                        ← generated by /init, extended in Phase 0
├── package.json                     ← workspace root
├── turbo.json
├── .gitignore
├── .env.example
│
├── supabase/
│   └── migrations/
│       ├── 0001_schema.sql          ← tables, indexes, constraints
│       ├── 0002_functions.sql       ← reserve/expire/confirm DB functions
│       ├── 0003_rls.sql             ← row level security policies
│       └── 0004_seed.sql            ← dev seed data
│
├── packages/
│   ├── types/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── models.ts            ← DB row types
│   │       ├── api.ts               ← request/response DTOs
│   │       └── errors.ts            ← ErrorCode enum (§6.2)
│   └── config/
│       ├── package.json
│       └── src/env.ts               ← zod-validated env loader (§4.2)
│
├── apps/
│   ├── api/                         ← Elysia + Bun
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts             ← server entry, plugin wiring
│   │       ├── db/
│   │       │   ├── client.ts        ← Supabase service-role client
│   │       │   └── transaction.ts   ← withTransaction() helper
│   │       ├── lib/
│   │       │   ├── jwt.ts           ← signAccess/signRefresh/signQR + verify
│   │       │   ├── password.ts      ← hash/verify (argon2)
│   │       │   ├── razorpay.ts      ← SDK wrapper + HMAC verification
│   │       │   ├── cloudinary.ts    ← upload + moderation
│   │       │   ├── logger.ts        ← pino, request-scoped
│   │       │   └── errors.ts        ← AppError class + toEnvelope()
│   │       ├── middleware/
│   │       │   ├── auth.ts          ← requireAuth, requireRole
│   │       │   ├── rateLimit.ts     ← Redis-backed limiter
│   │       │   ├── requestId.ts
│   │       │   └── errorHandler.ts  ← global → envelope
│   │       ├── services/            ← ALL business logic lives here
│   │       │   ├── auth.service.ts
│   │       │   ├── event.service.ts
│   │       │   ├── reservation.service.ts
│   │       │   ├── payment.service.ts    ← confirmPayment() lives here
│   │       │   ├── refund.service.ts
│   │       │   ├── ticket.service.ts
│   │       │   ├── organizer.service.ts
│   │       │   ├── admin.service.ts
│   │       │   └── audit.service.ts
│   │       ├── routes/              ← thin: validate → call service → envelope
│   │       │   ├── auth.routes.ts
│   │       │   ├── event.routes.ts
│   │       │   ├── ticket.routes.ts
│   │       │   ├── payment.routes.ts
│   │       │   ├── refund.routes.ts
│   │       │   ├── organizer.routes.ts
│   │       │   ├── admin.routes.ts
│   │       │   └── health.routes.ts
│   │       ├── queues/
│   │       │   ├── index.ts         ← queue definitions
│   │       │   ├── email.worker.ts
│   │       │   ├── media.worker.ts
│   │       │   └── reconcile.worker.ts
│   │       └── jobs/
│   │           ├── expireReservations.ts
│   │           └── reconcilePayments.ts
│   │
│   └── web/                         ← Next.js 15
│       ├── package.json
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       └── src/
│           ├── app/
│           │   ├── layout.tsx
│           │   ├── page.tsx
│           │   ├── events/
│           │   │   ├── page.tsx
│           │   │   └── [id]/page.tsx
│           │   ├── auth/
│           │   │   ├── login/page.tsx
│           │   │   ├── register/page.tsx
│           │   │   └── forgot-password/page.tsx
│           │   ├── (protected)/
│           │   │   ├── layout.tsx           ← auth guard
│           │   │   ├── dashboard/page.tsx
│           │   │   ├── tickets/[id]/page.tsx
│           │   │   ├── organizer/
│           │   │   │   ├── upgrade/page.tsx
│           │   │   │   ├── events/page.tsx
│           │   │   │   ├── events/create/page.tsx
│           │   │   │   ├── events/[id]/page.tsx
│           │   │   │   ├── events/[id]/analytics/page.tsx
│           │   │   │   └── events/[id]/scan/page.tsx
│           │   │   └── admin/
│           │   │       ├── page.tsx
│           │   │       ├── users/page.tsx
│           │   │       ├── organizers/page.tsx
│           │   │       └── events/page.tsx
│           │   └── api/health/route.ts
│           ├── components/
│           ├── hooks/
│           └── lib/
│               ├── apiClient.ts     ← envelope-aware fetch wrapper
│               └── supabase.ts
│
├── tests/
│   ├── integration/
│   └── rls/
└── load-tests/
    └── ticket-drop.js               ← k6
```

---

## §4. DEPENDENCIES & ENVIRONMENT

### §4.1 Package manifest

**Root (workspace):**
```
turbo, typescript@^5, prettier, eslint
```

**apps/api:**
```
elysia, @elysiajs/cors, @elysiajs/swagger,
@supabase/supabase-js@^2,
razorpay, cloudinary,
jose            (JWT sign/verify — not jsonwebtoken)
argon2          (password hashing — not bcrypt)
bullmq, ioredis,
pino, pino-pretty,
zod
```

**apps/web:**
```
next@^15, react@^19, react-dom@^19,
@supabase/supabase-js,
tailwindcss, @tailwindcss/forms,
mapbox-gl, react-map-gl,
qrcode.react            (render QR)
html5-qrcode            (scan QR)
@tanstack/react-query,
zod, react-hook-form, @hookform/resolvers
```

**packages/types, packages/config:** `zod` only.

**Dev/test:** `bun:test` (built in), `k6` (installed separately, not npm).

Use current stable versions. Do not pin to versions in this doc except where a major is specified.

### §4.2 Environment contract

Create `.env.example` with exactly these keys. `packages/config/src/env.ts` validates them with zod at boot and throws on any missing/invalid value.

```bash
# ---- Runtime
NODE_ENV=development              # development | staging | production
API_PORT=3001
WEB_URL=http://localhost:3000
API_URL=http://localhost:3001

# ---- Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # API only. NEVER expose to web.

# ---- Auth (R8: two distinct secrets)
JWT_SECRET=                       # min 32 chars
QR_JWT_SECRET=                    # min 32 chars, MUST differ from JWT_SECRET
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
QR_TOKEN_TTL=24h

# ---- Razorpay
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# ---- Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# ---- Mapbox
NEXT_PUBLIC_MAPBOX_TOKEN=

# ---- Redis
REDIS_URL=redis://localhost:6379

# ---- Business rules (tunable without code change)
RESERVATION_TTL_MINUTES=10
MAX_TICKETS_PER_USER_PER_EVENT=10
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
API_RATE_LIMIT_PER_MINUTE=100
```

**Boot validation must assert:** `JWT_SECRET !== QR_JWT_SECRET`, both ≥32 chars. Fail loudly if violated.

---

## §5. DATA LAYER

### §5.1 State machines

Implement these transitions exactly. Any transition not drawn here is illegal and must be rejected.

**Ticket reservation lifecycle** (`tickets.reservation_status`):
```
                  ┌──────────► expired  (TTL elapsed, inventory restored)
                  │
   [reserve] ──► reserved ──► confirmed ──► cancelled  (refund issued)
                  │
                  └──────────► cancelled (user abandons before payment)
```

**Ticket validity** (`tickets.status`) — independent of the above, only meaningful once `confirmed`:
```
   valid ──[QR scanned at door]──► invalid    (one-way, terminal)
```

**Payment lifecycle** (`payments.status`):
```
   pending ──► captured ──► refunded
      │
      └──────► failed
```

Rules:
- A ticket may only be scanned if `reservation_status='confirmed' AND status='valid'`.
- Inventory is decremented on entry to `reserved`, and restored on entry to `expired` or `cancelled`. It is **not** touched on `confirmed`.
- `payments.status='captured'` and its tickets' `reservation_status='confirmed'` are set in the same transaction. They can never disagree.

### §5.2 `0001_schema.sql`

```sql
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

-- ============================================================
create table users (
  id             uuid primary key default uuid_generate_v4(),
  name           varchar(120) not null,
  email          varchar(255) not null unique,
  password_hash  text not null,
  role           varchar(20) not null default 'attendee'
                 check (role in ('attendee','organizer','admin')),
  status         varchar(20) not null default 'active'
                 check (status in ('active','disabled')),
  failed_login_attempts int not null default 0,
  locked_until   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_users_email on users(lower(email));
create index idx_users_role  on users(role) where status = 'active';

-- ============================================================
create table organizers (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null unique references users(id) on delete cascade,
  organization_name   varchar(200) not null,
  contact_number      varchar(10) not null check (contact_number ~ '^[0-9]{10}$'),
  address             text,
  description         text,
  kyc_document_url    text,
  verification_status varchar(20) not null default 'pending'
                      check (verification_status in ('pending','approved','rejected')),
  rejection_reason    text,
  version             integer not null default 1,   -- optimistic lock (R: admin race)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_organizers_pending on organizers(created_at)
  where verification_status = 'pending';

-- ============================================================
create table events (
  id                        uuid primary key default uuid_generate_v4(),
  organizer_id              uuid not null references organizers(id) on delete restrict,
  title                     varchar(200) not null,
  description               text,
  event_type                varchar(50),
  location_name             varchar(200),
  address                   text,
  city                      varchar(100) not null,
  latitude                  double precision,
  longitude                 double precision,
  start_time                timestamptz not null,
  end_time                  timestamptz not null,
  poster_url                text,
  video_url                 text,
  images_urls               text[] not null default '{}',
  terms_and_conditions      text,
  refund_policy             jsonb not null default
                            '{"full_refund_hours":48,"partial_refund_percent":50}'::jsonb,
  organizer_status_snapshot varchar(20),      -- organizer verification at creation time
  admin_flagged             boolean not null default false,
  cancelled_at              timestamptz,
  search_vector             tsvector generated always as (
                              to_tsvector('english',
                                coalesce(title,'') || ' ' || coalesce(description,''))
                            ) stored,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint chk_event_times check (end_time > start_time),
  constraint chk_images_max  check (array_length(images_urls,1) is null
                                    or array_length(images_urls,1) <= 3)
);
create index idx_events_city_start on events(city, start_time);
create index idx_events_organizer  on events(organizer_id);
create index idx_events_search     on events using gin(search_vector);
create index idx_events_upcoming   on events(start_time) where cancelled_at is null;

-- R7: status is computed, never stored
create view events_with_status as
select e.*,
  case
    when e.cancelled_at is not null      then 'cancelled'
    when now() < e.start_time            then 'upcoming'
    when now() between e.start_time and e.end_time then 'ongoing'
    else 'past'
  end as status
from events e;

-- ============================================================
create table ticket_descriptions (
  id                uuid primary key default uuid_generate_v4(),
  event_id          uuid not null references events(id) on delete cascade,
  ticket_type_name  varchar(100) not null,
  ticket_description text,
  price             numeric(10,2) not null check (price >= 0),
  total_tickets     integer not null check (total_tickets > 0),
  available_tickets integer not null check (available_tickets >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_available_lte_total check (available_tickets <= total_tickets)
);
create index idx_td_event on ticket_descriptions(event_id);

-- ============================================================
create table tickets (
  id                     uuid primary key default uuid_generate_v4(),
  user_id                uuid not null references users(id) on delete restrict,
  event_id               uuid not null references events(id) on delete restrict,
  ticket_description_id  uuid not null references ticket_descriptions(id) on delete restrict,
  payment_id             uuid,                          -- FK added after payments table
  status                 varchar(20) not null default 'valid'
                         check (status in ('valid','invalid')),
  reservation_status     varchar(20) not null default 'reserved'
                         check (reservation_status in
                           ('reserved','confirmed','expired','cancelled')),
  reserved_at            timestamptz not null default now(),
  reservation_expires_at timestamptz not null,
  qr_jwt_token           text,
  qr_nonce               uuid not null default uuid_generate_v4(),
  verified_at            timestamptz,
  verified_by            uuid references users(id),
  created_at             timestamptz not null default now()
);
create index idx_tickets_user  on tickets(user_id, created_at desc);
create index idx_tickets_event on tickets(event_id)
  where reservation_status = 'confirmed';
create index idx_tickets_expiry on tickets(reservation_expires_at)
  where reservation_status = 'reserved';
create index idx_tickets_qr_nonce on tickets(qr_nonce);

-- ============================================================
create table payments (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references users(id) on delete restrict,
  event_id            uuid not null references events(id) on delete restrict,
  razorpay_order_id   varchar(100) not null unique,
  razorpay_payment_id varchar(100) unique,     -- R3: idempotency anchor
  razorpay_signature  varchar(255),
  amount              numeric(10,2) not null check (amount > 0),
  currency            char(3) not null default 'INR',
  status              varchar(20) not null default 'pending'
                      check (status in ('pending','captured','failed','refunded')),
  payment_method      varchar(50),
  failure_reason      text,
  webhook_processed   boolean not null default false,
  webhook_received_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_payments_user   on payments(user_id, created_at desc);
create index idx_payments_status on payments(status)
  where status in ('pending','captured');

alter table tickets
  add constraint fk_tickets_payment
  foreign key (payment_id) references payments(id) on delete set null;

-- ============================================================
create table refunds (
  id                 uuid primary key default uuid_generate_v4(),
  payment_id         uuid not null references payments(id) on delete restrict,
  ticket_id          uuid not null references tickets(id) on delete restrict,
  initiated_by       uuid not null references users(id),
  reason             varchar(30) not null
                     check (reason in ('user_requested','event_cancelled','organizer_action')),
  status             varchar(20) not null default 'pending'
                     check (status in ('pending','processed','failed')),
  razorpay_refund_id varchar(100) unique,
  amount             numeric(10,2) not null check (amount > 0),
  failure_reason     text,
  created_at         timestamptz not null default now(),
  processed_at       timestamptz,
  constraint uq_refund_per_ticket unique (ticket_id)   -- one refund per ticket
);

-- ============================================================
create table audit_logs (
  id            uuid primary key default uuid_generate_v4(),
  actor_user_id uuid references users(id),
  action_type   varchar(60) not null,
  target_table  varchar(50) not null,
  target_id     uuid not null,
  old_value     jsonb,
  new_value     jsonb,
  ip_address    inet,
  request_id    varchar(64),
  created_at    timestamptz not null default now()
);
create index idx_audit_target on audit_logs(target_table, target_id, created_at desc);
create index idx_audit_actor  on audit_logs(actor_user_id, created_at desc);

-- ============================================================
-- updated_at triggers
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['users','organizers','events','ticket_descriptions','payments']
  loop
    execute format(
      'create trigger trg_%1$s_updated before update on %1$s
       for each row execute function set_updated_at()', t);
  end loop;
end $$;
```

### §5.3 `0002_functions.sql` — the atomic core

**These three functions are the heart of the system. Implement them exactly as written.** They exist so that inventory safety is enforced by PostgreSQL, not by application code that could be refactored wrong later.

```sql
-- ============================================================
-- reserve_tickets: R1 — the ONLY legal way to decrement inventory.
-- Locks the ticket type row, verifies availability and per-user cap,
-- decrements, and creates N reserved ticket rows atomically.
-- ============================================================
create or replace function reserve_tickets(
  p_user_id               uuid,
  p_ticket_description_id uuid,
  p_quantity              integer,
  p_ttl_minutes           integer default 10,
  p_max_per_user          integer default 10
)
returns table (ticket_id uuid, expires_at timestamptz)
language plpgsql
as $$
declare
  v_available   integer;
  v_event_id    uuid;
  v_already     integer;
  v_expires     timestamptz;
  i             integer;
  v_new_id      uuid;
begin
  if p_quantity < 1 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- Lock the inventory row. Concurrent callers serialize here.
  select available_tickets, event_id
    into v_available, v_event_id
  from ticket_descriptions
  where id = p_ticket_description_id
  for update;

  if not found then
    raise exception 'TICKET_TYPE_NOT_FOUND';
  end if;

  if v_available < p_quantity then
    raise exception 'TICKET_SOLD_OUT';
  end if;

  -- Per-user cap across reserved + confirmed tickets for this event
  select count(*) into v_already
  from tickets
  where user_id = p_user_id
    and event_id = v_event_id
    and reservation_status in ('reserved','confirmed');

  if v_already + p_quantity > p_max_per_user then
    raise exception 'TICKET_LIMIT_EXCEEDED';
  end if;

  update ticket_descriptions
     set available_tickets = available_tickets - p_quantity
   where id = p_ticket_description_id;

  v_expires := now() + make_interval(mins => p_ttl_minutes);

  for i in 1..p_quantity loop
    insert into tickets (
      user_id, event_id, ticket_description_id,
      reservation_status, reserved_at, reservation_expires_at
    ) values (
      p_user_id, v_event_id, p_ticket_description_id,
      'reserved', now(), v_expires
    ) returning id into v_new_id;

    ticket_id := v_new_id;
    expires_at := v_expires;
    return next;
  end loop;
end $$;

-- ============================================================
-- expire_reservations: restores inventory for lapsed reservations.
-- Run every 60s (Phase 4 job). Safe to run concurrently.
-- ============================================================
create or replace function expire_reservations()
returns integer
language plpgsql
as $$
declare
  v_count integer := 0;
begin
  with lapsed as (
    select id, ticket_description_id
    from tickets
    where reservation_status = 'reserved'
      and reservation_expires_at < now()
    for update skip locked          -- concurrent-safe
  ),
  released as (
    update tickets t
       set reservation_status = 'expired'
      from lapsed l
     where t.id = l.id
    returning t.ticket_description_id
  ),
  restored as (
    select ticket_description_id, count(*) as n
    from released
    group by ticket_description_id
  )
  update ticket_descriptions td
     set available_tickets = least(td.available_tickets + r.n, td.total_tickets)
    from restored r
   where td.id = r.ticket_description_id;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ============================================================
-- verify_ticket_atomic: R — one-way, single-use QR redemption.
-- Returns 0 rows if the ticket was already scanned. The caller
-- MUST treat 0 rows as TICKET_ALREADY_USED, never retry-and-succeed.
-- ============================================================
create or replace function verify_ticket_atomic(
  p_ticket_id  uuid,
  p_event_id   uuid,
  p_scanner_id uuid
)
returns table (ticket_id uuid, attendee_name text, verified_at timestamptz)
language plpgsql
as $$
begin
  return query
  update tickets t
     set status = 'invalid',
         verified_at = now(),
         verified_by = p_scanner_id
   where t.id = p_ticket_id
     and t.event_id = p_event_id
     and t.status = 'valid'
     and t.reservation_status = 'confirmed'
  returning t.id,
            (select u.name from users u where u.id = t.user_id),
            t.verified_at;
end $$;
```

### §5.4 `0003_rls.sql`

```sql
alter table users               enable row level security;
alter table organizers          enable row level security;
alter table events              enable row level security;
alter table ticket_descriptions enable row level security;
alter table tickets             enable row level security;
alter table payments            enable row level security;
alter table refunds             enable row level security;
alter table audit_logs          enable row level security;

-- helper: current user's organizer id
create or replace function current_organizer_id() returns uuid
language sql stable as $$
  select id from organizers where user_id = auth.uid()
$$;

create or replace function is_admin() returns boolean
language sql stable as $$
  select exists (select 1 from users where id = auth.uid() and role = 'admin')
$$;

-- ---------- users
create policy users_self_read on users
  for select using (id = auth.uid() or is_admin());
create policy users_self_update on users
  for update using (id = auth.uid());

-- ---------- organizers
create policy organizers_self_read on organizers
  for select using (user_id = auth.uid() or is_admin());
create policy organizers_self_write on organizers
  for update using (user_id = auth.uid() or is_admin());

-- ---------- events (public read; owner or admin write)
create policy events_public_read on events
  for select using (true);
create policy events_owner_write on events
  for all using (organizer_id = current_organizer_id() or is_admin());

-- ---------- ticket_descriptions
create policy td_public_read on ticket_descriptions
  for select using (true);
create policy td_owner_write on ticket_descriptions
  for all using (
    event_id in (select id from events where organizer_id = current_organizer_id())
    or is_admin()
  );

-- ---------- tickets: owner, event-organizer, or admin
create policy tickets_owner_read on tickets
  for select using (
    user_id = auth.uid()
    or event_id in (select id from events where organizer_id = current_organizer_id())
    or is_admin()
  );

-- ---------- payments: strictly owner or admin (organizers must NOT see payment PII)
create policy payments_owner_read on payments
  for select using (user_id = auth.uid() or is_admin());

-- ---------- refunds
create policy refunds_owner_read on refunds
  for select using (
    payment_id in (select id from payments where user_id = auth.uid())
    or is_admin()
  );

-- ---------- audit_logs: admin only
create policy audit_admin_only on audit_logs
  for select using (is_admin());

-- ============================================================
-- PII-safe attendee list for organizers: name only, never email/phone
create view event_attendee_summary as
select t.id            as ticket_id,
       t.event_id,
       u.name          as attendee_name,
       t.status,
       t.verified_at,
       td.ticket_type_name
from tickets t
join users u  on u.id = t.user_id
join ticket_descriptions td on td.id = t.ticket_description_id
where t.reservation_status = 'confirmed';
```

---

## §6. API CONTRACT

### §6.1 Response envelope (R9)

Every response, success or failure, uses this shape. No exceptions.

```ts
// packages/types/src/api.ts
export type ApiResponse<T> = {
  success: boolean;
  data: T | null;
  meta: { requestId: string; cursor?: string | null; total?: number } | null;
  error: { code: ErrorCode; message: string; field?: string } | null;
};
```

```json
// 200
{ "success": true, "data": { "id": "..." },
  "meta": { "requestId": "req_a1b2", "cursor": "eyJpZCI6..." }, "error": null }

// 409
{ "success": false, "data": null, "meta": { "requestId": "req_a1b2" },
  "error": { "code": "TICKET_SOLD_OUT",
             "message": "This ticket type is no longer available",
             "field": "ticketDescriptionId" } }
```

**Pagination is cursor-based.** `cursor` is a base64-encoded `{id, sortValue}`. Never use `OFFSET` on the events list.

### §6.2 Error code registry

Define as a TypeScript union in `packages/types/src/errors.ts`. Adding a new code requires adding it here. HTTP status is derived from the code, never set ad hoc.

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Elysia schema rejection; include `field` |
| `UNAUTHENTICATED` | 401 | Missing/expired/invalid access token |
| `INVALID_CREDENTIALS` | 401 | Incorrect email or password during login |
| `TOKEN_EXPIRED` | 401 | Specifically expired — frontend should refresh |
| `FORBIDDEN` | 403 | Authenticated but wrong role/ownership |
| `ACCOUNT_DISABLED` | 403 | `users.status = 'disabled'` |
| `ORGANIZER_NOT_APPROVED` | 403 | Organizer action before admin approval |
| `NOT_FOUND` | 404 | Resource does not exist or RLS hid it |
| `EMAIL_ALREADY_EXISTS` | 409 | Registration with taken email |
| `TICKET_SOLD_OUT` | 409 | `reserve_tickets` raised it |
| `TICKET_LIMIT_EXCEEDED` | 409 | Per-user cap hit |
| `RESERVATION_EXPIRED` | 409 | Payment attempted after TTL lapsed |
| `TICKET_ALREADY_USED` | 409 | QR scanned twice |
| `PAYMENT_ALREADY_PROCESSED` | 409 | Idempotent no-op signal (usually returns 200 with existing data instead) |
| `INVALID_SIGNATURE` | 400 | Razorpay HMAC mismatch |
| `REFUND_WINDOW_CLOSED` | 409 | Outside event's `refund_policy` |
| `REFUND_ALREADY_ISSUED` | 409 | `uq_refund_per_ticket` violation |
| `VERSION_CONFLICT` | 409 | Optimistic lock failed (organizer approval race) |
| `RATE_LIMITED` | 429 | Include `Retry-After` header |
| `ACCOUNT_LOCKED` | 429 | Too many failed logins |
| `UPSTREAM_UNAVAILABLE` | 502 | Razorpay/Cloudinary down |
| `INTERNAL_ERROR` | 500 | Unhandled — log with requestId, never leak the message |

### §6.3 Endpoint table

All routes prefixed `/api/v1`. **Auth** column: `—` public · `U` any authenticated · `O` approved organizer · `A` admin · `Owner` resource owner.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | Liveness + DB + Redis check |
| POST | `/auth/register` | — | Create attendee account |
| POST | `/auth/login` | — | Issue access + refresh (refresh in httpOnly cookie) |
| POST | `/auth/refresh` | — | Rotate refresh token, issue new access |
| POST | `/auth/logout` | U | Revoke refresh token |
| GET | `/auth/me` | U | Current user + organizer status |
| POST | `/auth/forgot-password` | — | Enqueue reset email (always 200, no enumeration) |
| POST | `/auth/reset-password` | — | Consume reset token |
| GET | `/events` | — | Search/filter/paginate. Query: `q, city, from, to, cursor, limit` |
| GET | `/events/:id` | — | Detail + ticket types + live availability |
| POST | `/events` | O | Create event; snapshots organizer status |
| PATCH | `/events/:id` | Owner/A | Update; if tickets sold, requires `changeReason`, notifies holders |
| DELETE | `/events/:id` | Owner/A | Soft-cancel; triggers bulk refund if tickets sold |
| POST | `/events/:id/media` | Owner | Cloudinary upload (poster/images≤3/video) |
| GET | `/events/:id/attendees` | Owner/A | Reads `event_attendee_summary` (PII-safe) |
| GET | `/events/:id/analytics` | Owner/A | Sold, revenue, check-in rate, by-date |
| POST | `/events/:id/ticket-types` | Owner | Create ticket type |
| PATCH | `/ticket-types/:id` | Owner | Update; cannot reduce `total_tickets` below sold |
| DELETE | `/ticket-types/:id` | Owner | Only if zero tickets sold |
| POST | `/events/:id/reserve` | U | **Calls `reserve_tickets()`.** Returns ticketIds + expiresAt |
| DELETE | `/reservations/:id` | Owner | Release early; restores inventory |
| GET | `/tickets` | U | Own tickets, confirmed first |
| GET | `/tickets/:id` | Owner | Ticket + QR JWT |
| POST | `/tickets/verify` | O/A | Scan QR. Calls `verify_ticket_atomic()` |
| POST | `/payments/order` | U | Create Razorpay order against active reservation |
| POST | `/payments/verify` | U | Client callback → `confirmPayment()` |
| POST | `/payments/webhook` | — | Razorpay webhook → `confirmPayment()`. HMAC-verified |
| GET | `/payments/:id` | Owner | Payment detail |
| POST | `/tickets/:id/refund` | Owner | User-initiated, applies `refund_policy` |
| POST | `/organizers/upgrade` | U | Submit org details + KYC PDF |
| GET | `/organizers/me` | U | Own organizer record + status |
| PATCH | `/organizers/me` | O | Update org profile |
| GET | `/admin/users` | A | Paginated, filterable |
| PATCH | `/admin/users/:id/status` | A | Enable/disable |
| GET | `/admin/organizers/pending` | A | Approval queue |
| POST | `/admin/organizers/:id/approve` | A | Requires `version` in body (optimistic lock) |
| POST | `/admin/organizers/:id/reject` | A | Requires `version` + `reason` |
| GET | `/admin/events` | A | All events, any status |
| GET | `/admin/audit-logs` | A | Paginated audit trail |
| GET | `/admin/dashboard` | A | Platform metrics |

---

## §7. CRITICAL PATH: FUNCTION CONTRACTS

Implement these signatures exactly. They are the functions where bugs cost money.

### §7.1 The purchase sequence

```
Client                API                    Postgres              Razorpay
  │                    │                        │                     │
  │─POST /reserve─────►│                        │                     │
  │                    │─reserve_tickets()─────►│ LOCK ticket_desc    │
  │                    │                        │ check + decrement   │
  │                    │◄──ticketIds, expiry────│ INSERT reserved     │
  │◄──10min countdown──│                        │                     │
  │                    │                        │                     │
  │─POST /payments/order──►│                    │                     │
  │                    │─verify reservation ───►│                     │
  │                    │   still 'reserved'     │                     │
  │                    │─────────create order──────────────────────► │
  │                    │─INSERT payment pending►│                     │
  │◄──orderId, amount──│                        │                     │
  │                    │                        │                     │
  │══ Razorpay checkout UI ══════════════════════════════════════════►│
  │                    │                        │                     │
  │─POST /payments/verify─►│                    │                     │
  │                    │  confirmPayment() ─── BEGIN TX ───►          │
  │                    │    verify HMAC         │                     │
  │                    │    lock payment row    │                     │
  │                    │    idempotency check   │                     │
  │                    │    payment→captured    │                     │
  │                    │    tickets→confirmed   │                     │
  │                    │    sign QR JWTs        │                     │
  │                    │  ◄─── COMMIT ──────────│                     │
  │                    │─enqueue email (async)  │                     │
  │◄──tickets + QR─────│                        │                     │
  │                    │                        │                     │
  │            (independently, possibly earlier or twice)             │
  │                    │◄────────── POST /payments/webhook ───────────│
  │                    │  confirmPayment()  → idempotent no-op        │
```

**Note the ordering hazard the webhook creates:** the webhook may arrive *before* the client's `/payments/verify`, or twice, or the client may never call verify at all (browser closed). `confirmPayment()` is therefore the single shared implementation, and the webhook is the authority. `/payments/verify` is a latency optimization for the user's UI, not the source of truth.

### §7.2 `payment.service.ts`

```ts
/**
 * The single source of truth for turning a Razorpay payment into confirmed tickets.
 * Called by BOTH POST /payments/verify and POST /payments/webhook.
 *
 * MUST be idempotent (R3): calling twice with the same razorpayPaymentId
 * produces one captured payment, one set of confirmed tickets, one email.
 * MUST be transactional (R2).
 *
 * @throws AppError(INVALID_SIGNATURE)     — HMAC mismatch; nothing is written
 * @throws AppError(RESERVATION_EXPIRED)   — TTL lapsed before payment landed
 * @throws AppError(NOT_FOUND)             — no payment for that order id
 */
export async function confirmPayment(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  source: 'client' | 'webhook';
}): Promise<ConfirmedPurchase>;
```

Required implementation order inside `confirmPayment`:

1. Verify HMAC-SHA256 (`orderId|paymentId` with `RAZORPAY_KEY_SECRET`) **before touching the database.** Reject → `INVALID_SIGNATURE`.
2. `BEGIN`.
3. `SELECT * FROM payments WHERE razorpay_order_id = $1 FOR UPDATE`.
4. **Idempotency gate:** if `status = 'captured'`, `COMMIT` and return the existing tickets. Do not re-issue QR codes, do not re-enqueue email.
5. Load the associated tickets. If any has `reservation_status = 'expired'` → throw `RESERVATION_EXPIRED` (rollback). Handle the refund of an orphaned capture via the reconciliation job, not here.
6. `UPDATE payments SET status='captured', razorpay_payment_id, razorpay_signature, webhook_processed = (source='webhook'), webhook_received_at`.
7. `UPDATE tickets SET reservation_status='confirmed', payment_id, qr_jwt_token = <signed>` for each ticket.
8. `COMMIT`.
9. **After commit**, enqueue the confirmation email. Never inside the transaction (R5).

QR JWT payload — sign with `QR_JWT_SECRET` (R8), TTL `QR_TOKEN_TTL`:
```ts
{ tid: ticket.id, eid: event.id, nonce: ticket.qr_nonce, iat, exp }
```
No PII in the QR payload. The scanner resolves the attendee name server-side.

### §7.3 `reservation.service.ts`

```ts
/**
 * Wraps the reserve_tickets() Postgres function (§5.3).
 * NEVER implement the availability check in TypeScript (R1) — the
 * check and the decrement must happen inside one locked DB transaction.
 *
 * Maps Postgres exceptions to AppError:
 *   TICKET_SOLD_OUT        → AppError(TICKET_SOLD_OUT, 409)
 *   TICKET_LIMIT_EXCEEDED  → AppError(TICKET_LIMIT_EXCEEDED, 409)
 *   TICKET_TYPE_NOT_FOUND  → AppError(NOT_FOUND, 404)
 */
export async function createReservation(input: {
  userId: string;
  ticketDescriptionId: string;
  quantity: number;
}): Promise<{ ticketIds: string[]; expiresAt: Date }>;
```

### §7.4 `ticket.service.ts`

```ts
/**
 * Redeem a QR code at the door.
 * Delegates the state change to verify_ticket_atomic() (§5.3).
 * Zero returned rows means the ticket was ALREADY scanned — surface
 * TICKET_ALREADY_USED. Do not retry, do not fall back to a read-then-write.
 *
 * Authorization: scannerUserId must be the event's organizer, or an admin.
 */
export async function verifyTicketByQr(input: {
  qrToken: string;
  scannerUserId: string;
}): Promise<{ attendeeName: string; ticketType: string; verifiedAt: Date }>;
```

### §7.5 `refund.service.ts`

```ts
/**
 * Refund policy resolution, from events.refund_policy:
 *   hoursUntilEvent >= full_refund_hours  → 100% refund
 *   hoursUntilEvent >  0                  → partial_refund_percent
 *   event already started                 → REFUND_WINDOW_CLOSED
 *   reason = 'event_cancelled'            → always 100%, policy ignored
 *
 * On success (one transaction):
 *   payments.status  → 'refunded'
 *   tickets.reservation_status → 'cancelled'
 *   ticket_descriptions.available_tickets restored
 *   refunds row inserted (uq_refund_per_ticket prevents doubles)
 * Then, after commit: call Razorpay refund API, update refunds.status.
 */
export async function issueRefund(input: {
  ticketId: string;
  initiatedBy: string;
  reason: 'user_requested' | 'event_cancelled' | 'organizer_action';
}): Promise<Refund>;
```

### §7.6 Background jobs

| Job | Schedule | Contract |
|---|---|---|
| `expireReservations` | every 60s | Calls `expire_reservations()`. Logs count. Idempotent. |
| `reconcilePayments` | every 5 min | Finds `payments.status='captured'` with zero `confirmed` tickets → repairs by re-running confirmation, or flags for admin if the reservation expired. Emits an alert when count > 10. |
| `cleanupOrphanedUploads` | daily | Cloudinary/Supabase Storage assets with no DB reference, older than 24h → delete. |
| `eventReminders` | hourly | Enqueue reminder emails for events starting in ~24h. |

---

## §8. SECURITY REQUIREMENTS

| Area | Requirement |
|---|---|
| Password hashing | argon2id. Never bcrypt/MD5/SHA. |
| Access token | 15 min, `Authorization: Bearer`. Payload: `{sub, role, status, iat, exp}`. |
| Refresh token | 7 days, httpOnly + Secure + SameSite=Strict cookie. **Rotated on every use**; old token added to a Redis denylist until natural expiry. |
| QR token | Separate secret (R8), 24h TTL, no PII. |
| Session revocation | `requireAuth` re-reads `users.status` from DB. A disabled user's live access token stops working within 15 min at worst, immediately on refresh. |
| Login throttle | 5 failures → `locked_until = now() + 15min`. Counter resets on success. |
| Rate limits | Redis sliding window. Global 100/min/IP; `/auth/login` 10/min/IP; `/events/:id/reserve` 20/min/user; `/payments/order` max 3 pending orders per user. |
| File upload | Verify magic bytes, not extension. KYC: `%PDF-` header, ≤10MB. Images: ≤5MB each, max 3. Run Cloudinary moderation; flag failures for admin. |
| Webhook auth | Verify `X-Razorpay-Signature` against `RAZORPAY_WEBHOOK_SECRET`. Reject unsigned requests before any DB work. |
| XSS | Sanitize `events.description` with DOMPurify server-side before storage. CSP header on Next.js. |
| PII | Organizers see attendee **names only** (`event_attendee_summary`). Never emails, phones, or payment records. |
| Logging | Never log tokens, password hashes, Razorpay secrets, or full card metadata. Log `requestId` + `userId` only. |

---

## §9. OBSERVABILITY

Structured JSON logs (pino). Every request logs: `requestId, method, path, userId, statusCode, durationMs`.

**Metrics to expose at `/health` and track:**

| Metric | Alert threshold |
|---|---|
| Payment success rate | < 95% over 5 min → page |
| Reservation → confirmation conversion | < 40% over 1h → investigate (UX, not necessarily a bug) |
| `reconcilePayments` orphans found | > 10 in one run → page |
| API p95 latency | > 1000ms over 5 min → alert |
| `expire_reservations` runtime | > 5s → alert (index problem) |
| Queue depth (any queue) | > 1000 → alert |
| 5xx rate | > 1% over 5 min → page |

---

## §10. FAILURE MODES

Every row here must have a corresponding test in Phase 8.

| # | Scenario | Expected behaviour |
|---|---|---|
| F1 | 10,000 users race for the last 100 tickets | Exactly 100 reservations succeed. Others get `TICKET_SOLD_OUT`. `available_tickets` never negative. |
| F2 | Server crashes mid-`confirmPayment` | Transaction rolls back. Payment stays `pending`. `reconcilePayments` repairs within 5 min. |
| F3 | Razorpay webhook delivered twice | Second call is a no-op. One captured payment, one ticket set, one email. |
| F4 | Webhook arrives before client `/verify` | Webhook confirms. Client `/verify` returns the same tickets via the idempotency gate. |
| F5 | User closes browser after paying | Webhook still confirms. Tickets appear in `/tickets` on next login. |
| F6 | User pays after reservation TTL expired | `RESERVATION_EXPIRED`. Payment captured but unfulfillable → `reconcilePayments` flags for auto-refund. |
| F7 | Same QR scanned by two doors simultaneously | One succeeds; the other gets `TICKET_ALREADY_USED`. `verify_ticket_atomic` guarantees this. |
| F8 | Attendee screenshots and shares their QR | Second scan fails (one-way `valid→invalid`). |
| F9 | Two admins approve the same organizer at once | First wins. Second gets `VERSION_CONFLICT`. |
| F10 | Admin disables an organizer with live events | Events stay visible (ticket holders protected). New event creation blocked. Existing events get `admin_flagged = true`. |
| F11 | Organizer edits `start_time` after sales | Requires `changeReason`. All holders notified via queue. Change written to `audit_logs`. |
| F12 | Organizer cancels an event with 500 sold tickets | Bulk 100% refunds enqueued. Event `cancelled_at` set. Tickets → `cancelled`. |
| F13 | Cloudinary times out during event creation | Event is created without media. `UPSTREAM_UNAVAILABLE` on the media call only. Retry allowed. |
| F14 | Redis is down | Rate limiting fails **open** (log a warning). Queues fail **closed** (reject writes needing them). Never lose a payment because Redis blinked. |
| F15 | Malicious `role: "admin"` in registration body | Ignored. Role is server-assigned; registration always creates `attendee`. |
| F16 | Organizer A queries organizer B's ticket sales | RLS returns zero rows. Verified by Phase 8 RLS tests. |

---

## §11. BUILD PHASES

Each phase: implement → run acceptance criteria → show diff → commit with the exact message → stop for confirmation.

### Phase 0 — Foundation
**Build:** Workspace root (`package.json`, `turbo.json`, `.gitignore`, `.env.example` per §4.2), `packages/config` env loader with zod validation, `packages/types` skeleton with `ErrorCode` union from §6.2. Run `/init` and extend `CLAUDE.md` with the Global Rules (§2) and the anti-pattern table.

**Acceptance:**
- `bun run typecheck` passes at root
- Deleting any required env var causes a **boot failure with a named error**, not a runtime crash later
- Setting `JWT_SECRET === QR_JWT_SECRET` fails boot
- `CLAUDE.md` contains R1–R12

**Commit:** `chore: scaffold workspace, env validation, and shared types`

---

### Phase 1 — Database
**Build:** All four migrations from §5.2–§5.4 verbatim, plus `0004_seed.sql` (1 admin, 2 approved organizers, 1 pending organizer, 3 events, ~6 ticket types, 5 attendees).

**Acceptance:**
- Migrations apply cleanly to a fresh database
- `select reserve_tickets(<user>, <ticket_type>, 2)` returns 2 rows and decrements `available_tickets` by exactly 2
- Reserving more than available raises `TICKET_SOLD_OUT`
- Setting a reservation's `reservation_expires_at` to the past and running `expire_reservations()` restores inventory exactly
- `verify_ticket_atomic` on an already-invalid ticket returns **0 rows**
- `events_with_status` returns correct status for past/ongoing/future rows
- `insert into events` with `end_time < start_time` is rejected

**Commit:** `feat(db): add schema, atomic reservation functions, and RLS policies`

---

### Phase 2 — API foundation & auth
**Build:** Elysia server, `requestId`/`errorHandler`/`rateLimit`/`auth` middleware, `lib/jwt.ts`, `lib/password.ts`, `lib/logger.ts`, `lib/errors.ts`, `db/client.ts`, `db/transaction.ts`, all `/auth/*` routes, `/health`.

**Acceptance:**
- Register → login → `/auth/me` round-trips
- Every response (including 404s and 500s) matches the §6.1 envelope
- 6 bad logins → `ACCOUNT_LOCKED` with `Retry-After`
- Using a refresh token twice fails the second time (rotation + denylist)
- Disabling a user in the DB → their next `/auth/me` returns `ACCOUNT_DISABLED`
- `POST /auth/register` with `{"role":"admin"}` creates an **attendee** (F15)
- `/auth/forgot-password` returns 200 for unknown emails (no enumeration)

**Commit:** `feat(api): add auth, JWT rotation, rate limiting, and error envelope`

---

### Phase 3 — Events, ticket types, search
**Build:** `event.service.ts`, `event.routes.ts`, ticket-type CRUD, Cloudinary upload with magic-byte validation, cursor pagination, full-text search.

**Acceptance:**
- `GET /events?q=jazz&city=Kochi` uses `search_vector`; `EXPLAIN` shows the GIN index, no seq scan
- Cursor pagination returns no duplicates and no gaps across pages
- An organizer with `verification_status='pending'` gets `ORGANIZER_NOT_APPROVED` on `POST /events`
- Organizer A cannot `PATCH` organizer B's event (403, and RLS blocks it independently)
- Uploading a `.exe` renamed to `.pdf` is rejected on magic bytes
- Creating an event stores `organizer_status_snapshot = 'approved'`
- `GET /events/:id` returns live `available_tickets`, not a cached value

**Commit:** `feat(api): add event CRUD, ticket types, media upload, and full-text search`

---

### Phase 4 — Reservations, payments, refunds ⚠️
**The highest-risk phase. Do not rush it.**

**Build:** `reservation.service.ts`, `payment.service.ts` (with `confirmPayment` per §7.2), `refund.service.ts`, `ticket.service.ts` verification, all payment/refund/reserve routes, BullMQ queues + workers, `expireReservations` and `reconcilePayments` jobs.

**Acceptance:**
- `POST /events/:id/reserve` decrements inventory and returns `expiresAt`
- Two concurrent reservations for one remaining ticket: exactly one succeeds
- Reservation left unpaid past TTL → inventory restored within 60s
- `confirmPayment` called twice with identical input → one captured payment, one ticket set, **one** queued email (F3)
- Webhook-before-client ordering produces identical final state (F4)
- Tampered `razorpay_signature` → `INVALID_SIGNATURE`, zero DB writes
- Killing the process mid-transaction leaves payment `pending`, no confirmed tickets (F2)
- QR scan succeeds once, second scan → `TICKET_ALREADY_USED` (F7)
- Refund inside the full-refund window returns 100%; outside returns the partial percent; after start → `REFUND_WINDOW_CLOSED`
- Refunding the same ticket twice → `REFUND_ALREADY_ISSUED`
- Confirmation email is enqueued **after** commit, never inside the transaction

**Commit:** `feat(api): add reservation, payment confirmation, refunds, and background jobs`

---

### Phase 5 — Organizer & admin
**Build:** `organizer.service.ts`, `admin.service.ts`, `audit.service.ts`, KYC upload, approval flow with optimistic locking, all `/admin/*` routes.

**Acceptance:**
- KYC upload rejects non-PDF and files > 10MB
- Approving with a stale `version` → `VERSION_CONFLICT` (F9)
- Every admin mutation writes an `audit_logs` row with correct `old_value`/`new_value`
- Disabling an organizer sets `admin_flagged` on their events but leaves them publicly visible (F10)
- A non-admin hitting any `/admin/*` route gets 403 at both middleware and RLS layers
- `GET /events/:id/attendees` returns names but **no** emails or phone numbers

**Commit:** `feat(api): add organizer onboarding, admin controls, and audit logging`

---

### Phase 6 — Frontend foundation
**Build:** Next.js app, `lib/apiClient.ts` (envelope-aware, auto-refresh on `TOKEN_EXPIRED`, maps `ErrorCode` → user-facing copy), auth pages, protected layout guard, public event browse + detail, dark/light theme, mobile bottom nav.

**Acceptance:**
- `apiClient` transparently refreshes on 401/`TOKEN_EXPIRED` and retries once
- Visiting `/dashboard` unauthenticated redirects to login with a return URL
- An attendee cannot see organizer or admin nav items
- Event list is server-rendered and paginates without duplicates
- Theme persists across reloads
- Times display in the viewer's local timezone (R6), correct across a DST boundary

**Commit:** `feat(web): add app shell, auth flow, and public event browsing`

---

### Phase 7 — Booking, QR, dashboards
**Build:** Reservation flow with countdown, Razorpay checkout modal, ticket wallet + QR display, organizer QR scanner, event create/edit forms, analytics charts, admin panels, Mapbox discovery.

**Acceptance:**
- Reserving starts a visible countdown; on expiry the UI returns to "Buy" and calls `DELETE /reservations/:id`
- Closing the payment modal mid-flow does not leave the UI claiming success
- Ticket page renders a scannable QR
- Scanner shows attendee name on first scan, a clear "already used" state on second
- Analytics numbers match a direct DB query
- Map markers geocode correctly and filter to India
- Every error state renders a human message derived from `ErrorCode`, never a raw stack trace

**Commit:** `feat(web): add booking flow, QR wallet, scanner, and dashboards`

---

### Phase 8 — Verification
**Build:** Integration tests for the full payment flow (mocked Razorpay), an RLS test suite, a k6 load test at `load-tests/ticket-drop.js`, and one test per row of §10.

**Acceptance:**
- **F1 load test passes:** 10,000 virtual users, 100 tickets, exactly 100 sold, zero oversell, p95 < 2s
- Duplicate-webhook test proves idempotency
- RLS suite proves organizer A sees zero rows of organizer B's data
- Crash-recovery test proves `reconcilePayments` repairs an orphaned capture
- Every §10 row has a named, passing test
- `bun test` is green

**Commit:** `test: add integration, RLS, failure-mode, and load tests`

**Then tag:** `git tag v1.0.0-mvp`

---

## §12. CLAUDE.md CONTENT

After `/init`, append this to `CLAUDE.md` so the rules survive every future session:

```markdown
## Architecture
Full specification: @SPEC.md — read it before non-trivial changes.

## Inviolable rules
1. Inventory changes go through reserve_tickets() / expire_reservations(). Never decrement available_tickets in TypeScript.
2. Payment + ticket issuance is one transaction. confirmPayment() is the only place tickets become 'confirmed'.
3. confirmPayment() must stay idempotent — /payments/verify and /payments/webhook both call it.
4. Authorization = RLS policy + middleware check. Never middleware alone.
5. Email/SMS/analytics go to BullMQ. Never awaited in a request handler.
6. All timestamps timestamptz/UTC. Convert at render only.
7. Event status is computed via events_with_status. Never stored.
8. JWT_SECRET and QR_JWT_SECRET are distinct and never interchanged.
9. Every response uses the ApiResponse envelope with a registered ErrorCode.
10. Every admin mutation writes to audit_logs.

## Layering
routes/ → validate input, call a service, return the envelope. No business logic.
services/ → all business logic. No HTTP concerns.
db/ → Supabase client + transaction helper only.

## Commands
bun run dev        # api + web
bun test           # all tests
bun run typecheck
supabase migration up

## Before every commit
bun run typecheck && bun test
```

---

## §13. DEFINITION OF DONE

The build is complete when all of the following hold:

- [ ] All 8 phases committed with their specified messages
- [ ] `bun test` green; `bun run typecheck` clean
- [ ] Every row of §10 has a passing test
- [ ] k6 ticket-drop test: zero oversell at 10,000 concurrent users
- [ ] No `available_tickets` mutation exists outside the DB functions (grep to confirm)
- [ ] No `await sendEmail`/`await sendSms` inside any route handler (grep to confirm)
- [ ] `.env.example` documents every variable the code reads
- [ ] `CLAUDE.md` carries the §12 content
- [ ] Tagged `v1.0.0-mvp`

---

*End of specification.*
