# Event Ticketing Platform — Final Architecture & Build Playbook

**Stack:** Next.js 15 (App Router) + Elysia (Bun) + Supabase (PostgreSQL) + Razorpay + Cloudinary + Mapbox
**Status:** Production-grade draft, ready to build from
**How to use this doc:** Run each phase's prompt in Claude Code, in order. Commit after every phase.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Complete Database Schema](#2-complete-database-schema)
3. [Event-Driven Architecture (Queues)](#3-event-driven-architecture)
4. [Caching Strategy](#4-caching-strategy)
5. [API Contract Standard](#5-api-contract-standard)
6. [Security Architecture](#6-security-architecture)
7. [Observability Plan](#7-observability-plan)
8. [Deployment Topology](#8-deployment-topology)
9. [Failure Mode Table](#9-failure-mode-table)
10. [Scalability Roadmap](#10-scalability-roadmap)
11. [Build Playbook: Phase-by-Phase Prompts](#11-build-playbook)
12. [Using `/init` and CLAUDE.md](#12-using-init-and-claudemd)
13. [Git Workflow Per Phase](#13-git-workflow-per-phase)

---

## 1. System Overview

```
                    ┌─────────────────┐
                    │   Cloudflare     │  ← DDoS protection, CDN, WAF
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
     ┌────────▼────────┐          ┌─────────▼────────┐
     │  Next.js (Vercel) │          │  Elysia API        │
     │  SSR/ISR pages     │          │  (Railway/Fly.io)   │
     └────────┬──────────┘          │  Bun runtime,        │
              │                     │  auto-scaling         │
              │                     └─────────┬────────────┘
              │              ┌────────────────┼────────────────┐
              │      ┌───────▼──────┐ ┌───────▼──────┐ ┌───────▼──────┐
              │      │  Supabase     │ │  Redis        │ │  BullMQ       │
              │      │  PostgreSQL   │ │  (Upstash)     │ │  Workers       │
              │      │  primary +    │ │  cache/session │ │  background jobs│
              │      │  read replica │ │  /rate limit   │ │                │
              │      └───────────────┘ └────────────────┘ └────────────────┘
     ┌────────▼──────────┐
     │  Razorpay / Cloudinary / Mapbox  │
     └────────────────────┘
```

**Core principle:** every write to money or inventory (tickets) is a DB transaction with row-level locking. Everything else (email, SMS, analytics) is queued and asynchronous.

---

## 2. Complete Database Schema

```sql
-- ============================================
-- EXTENSIONS
-- ============================================
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

-- ============================================
-- USERS
-- ============================================
create table users (
  id uuid primary key default uuid_generate_v4(),
  name varchar(120) not null,
  email varchar(255) unique not null,
  password_hash varchar not null,
  role varchar(20) not null default 'attendee'
    check (role in ('attendee','organizer','admin')),
  status varchar(20) not null default 'active'
    check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_users_email on users(email);
create index idx_users_role on users(role);

-- ============================================
-- ORGANIZERS
-- ============================================
create table organizers (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  organization_name varchar(200) not null,
  contact_number varchar(10) not null check (contact_number ~ '^[0-9]{10}$'),
  address text,
  description text,
  kyc_document_url varchar,
  verification_status varchar(20) not null default 'pending'
    check (verification_status in ('pending','approved','rejected')),
  version int not null default 1,             -- optimistic locking
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_organizers_user on organizers(user_id);
create index idx_organizers_status on organizers(verification_status);

-- ============================================
-- EVENTS
-- ============================================
create table events (
  id uuid primary key default uuid_generate_v4(),
  organizer_id uuid not null references organizers(id) on delete cascade,
  title varchar(200) not null,
  description text,
  event_type varchar(50),
  location_name varchar(200),
  address text,
  city varchar(100) not null,
  latitude double precision,
  longitude double precision,
  start_time timestamptz not null,
  end_time timestamptz not null check (end_time > start_time),
  poster_url varchar,
  video_url varchar,
  images_urls text[] default '{}',
  terms_and_conditions text,
  refund_policy jsonb default '{"full_refund_hours": 48, "partial_refund_percent": 50}',
  organizer_status_snapshot varchar(20),        -- audit: status at creation time
  admin_flagged boolean default false,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_events_city on events(city);
create index idx_events_start_time on events(start_time);
create index idx_events_search on events using gin(search_vector);

-- Computed status as a view (never store manually-updated status)
create view events_with_status as
select *,
  case
    when now() < start_time then 'upcoming'
    when now() between start_time and end_time then 'ongoing'
    else 'past'
  end as status
from events;

-- ============================================
-- TICKET DESCRIPTIONS (ticket types)
-- ============================================
create table ticket_descriptions (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  ticket_type_name varchar(100) not null,
  ticket_description text,
  price numeric(10,2) not null check (price >= 0),
  total_tickets int not null check (total_tickets > 0),
  available_tickets int not null check (available_tickets >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_ticket_desc_event on ticket_descriptions(event_id);

-- ============================================
-- TICKETS (includes reservation lifecycle)
-- ============================================
create table tickets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id),
  event_id uuid not null references events(id),
  ticket_description_id uuid not null references ticket_descriptions(id),
  status varchar(20) not null default 'valid'
    check (status in ('valid','invalid')),
  reservation_status varchar(20) not null default 'reserved'
    check (reservation_status in ('reserved','confirmed','expired','cancelled')),
  reserved_at timestamptz not null default now(),
  reservation_expires_at timestamptz not null default (now() + interval '10 minutes'),
  qr_jwt_token text,
  qr_nonce uuid default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index idx_tickets_user on tickets(user_id);
create index idx_tickets_event on tickets(event_id);
create index idx_tickets_reservation_expiry on tickets(reservation_expires_at)
  where reservation_status = 'reserved';

-- ============================================
-- PAYMENTS
-- ============================================
create table payments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id),
  event_id uuid not null references events(id),
  razorpay_order_id varchar,
  razorpay_payment_id varchar unique,          -- idempotency anchor
  razorpay_signature varchar,
  amount numeric(10,2) not null,
  currency varchar(3) not null default 'INR',
  status varchar(20) not null default 'pending'
    check (status in ('pending','captured','failed')),
  payment_method varchar(50),
  associated_ticket_id uuid references tickets(id),
  webhook_processed boolean default false,
  webhook_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_payments_razorpay_payment_id on payments(razorpay_payment_id);

-- ============================================
-- REFUNDS (new subsystem)
-- ============================================
create table refunds (
  id uuid primary key default uuid_generate_v4(),
  payment_id uuid not null references payments(id),
  ticket_id uuid not null references tickets(id),
  reason varchar(30) not null
    check (reason in ('user_requested','event_cancelled','organizer_action')),
  status varchar(20) not null default 'pending'
    check (status in ('pending','processed','failed')),
  razorpay_refund_id varchar,
  amount numeric(10,2) not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ============================================
-- AUDIT LOGS
-- ============================================
create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  admin_user_id uuid references users(id),
  action_type varchar(50) not null,
  target_table varchar(50) not null,
  target_id uuid not null,
  old_value jsonb,
  new_value jsonb,
  ip_address varchar(45),
  created_at timestamptz not null default now()
);

-- ============================================
-- TRIGGERS
-- ============================================
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger trg_users_updated before update on users
  for each row execute function set_updated_at();
create trigger trg_organizers_updated before update on organizers
  for each row execute function set_updated_at();
create trigger trg_events_updated before update on events
  for each row execute function set_updated_at();
create trigger trg_ticket_desc_updated before update on ticket_descriptions
  for each row execute function set_updated_at();
create trigger trg_payments_updated before update on payments
  for each row execute function set_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table tickets enable row level security;
alter table payments enable row level security;
alter table events enable row level security;
alter table organizers enable row level security;

-- Users see only their own tickets
create policy "users_view_own_tickets" on tickets
  for select using (user_id = auth.uid());

-- Organizers see tickets only for their own events
create policy "organizers_view_own_event_tickets" on tickets
  for select using (
    event_id in (
      select id from events where organizer_id in (
        select id from organizers where user_id = auth.uid()
      )
    )
  );

-- Public: anyone can view events (details page is public)
create policy "public_view_events" on events for select using (true);

-- Organizers manage only their own events
create policy "organizers_manage_own_events" on events
  for all using (
    organizer_id in (select id from organizers where user_id = auth.uid())
  );

-- Users see only their own payments
create policy "users_view_own_payments" on payments
  for select using (user_id = auth.uid());

-- PII-safe attendee view for organizers (no email/phone exposure)
create view event_attendee_summary as
select t.id as ticket_id, t.user_id, u.name as attendee_name,
       t.status, t.verified_at, t.event_id
from tickets t
join users u on u.id = t.user_id;
```

---

## 3. Event-Driven Architecture

**Synchronous (must complete in the request):**
- Payment verification
- Ticket record creation
- `available_tickets` decrement (row-locked)

**Asynchronous (queued via BullMQ + Redis):**
| Queue | Jobs |
|---|---|
| `email-queue` | booking confirmation, password reset, event reminders |
| `media-queue` | image optimization, video transcoding |
| `notification-queue` | push notifications, SMS |
| `analytics-queue` | non-blocking event tracking |
| `reconciliation-queue` | payment↔ticket consistency checks (runs every 5 min) |

**Why:** purchase API response drops from ~2-3s to ~200ms. A failed email never fails a purchase.

---

## 4. Caching Strategy

| Layer | What | TTL | Invalidation |
|---|---|---|---|
| CDN (Cloudflare/Vercel) | static assets, event images | long | on deploy |
| Redis | event listings by city+status | 60s | on event edit |
| Redis | individual event detail | 120s | on event edit |
| Redis | ticket availability count (display only) | 5s | immediate on purchase |
| Materialized view | "trending events" | 5 min refresh | cron |

**Hard rule:** the actual purchase transaction never trusts cache — it re-verifies against the DB with `SELECT ... FOR UPDATE`.

---

## 5. API Contract Standard

```json
// Success
{
  "success": true,
  "data": { },
  "meta": { "page": 1, "total": 150, "cursor": "abc123" },
  "error": null
}

// Error
{
  "success": false,
  "data": null,
  "error": {
    "code": "TICKET_SOLD_OUT",
    "message": "This ticket type is no longer available",
    "field": "ticket_type_id"
  }
}
```

Versioning: `/api/v1/...`. Deprecate old versions 6 months after a new version ships.

---

## 6. Security Architecture

- **JWTs:** access token 15 min, refresh token 7 days (httpOnly cookie, rotated on use), QR JWT signed with a **separate secret**, 24hr expiry.
- **Rate limits:** login 5 attempts/15min lockout; ticket booking max 10/user/event; API 100 req/min/IP; max 3 pending payment orders per user.
- **File uploads:** MIME + magic-number validation, Cloudinary moderation API, 10MB KYC PDF cap.
- **CSRF/XSS:** SameSite=Strict cookies, DOMPurify on event descriptions, CSP headers.
- **Audit log:** every admin action (approvals, disables, refunds, deletions) written to `audit_logs`.

---

## 7. Observability Plan

- **Structured logging** (Pino): request_id, user_id, endpoint, duration, status.
- **Key metrics:** payment success rate (target >98%), reservation→confirmation conversion, p50/p95/p99 latency, queue depth, DB pool utilization.
- **Alerts:** payment failure >5%/5min → page on-call; reconciliation finds >10 orphans → alert; API error rate >1% → alert.

---

## 8. Deployment Topology

- **Dev:** local Supabase, Razorpay test mode.
- **Staging:** separate Supabase project, Razorpay test mode, prod-like data volume.
- **Production:** separate Supabase project, Razorpay live mode, read replicas on.

---

## 9. Failure Mode Table

| Operation | Failure Point | Recovery |
|---|---|---|
| Ticket purchase | Crash mid-transaction | DB rollback; reservation auto-expires in 10 min |
| Payment webhook | Arrives twice | Idempotency key on `razorpay_payment_id`, no-op on duplicate |
| QR scan | Network drop after DB update | Client polls for confirmation; atomic status transition prevents double-scan |
| KYC upload | File saved, DB write fails | Orphaned file cleanup cron (24hr sweep) |
| Event edit | Organizer edits mid-checkout | Version check; checkout uses snapshot at reservation time |
| Admin approval | Two admins approve simultaneously | Optimistic lock on `organizers.version` rejects second write |

---

## 10. Scalability Roadmap

| Users/month | Add |
|---|---|
| 0–10K | Current architecture as-is |
| 10K–100K | Redis caching, read replicas |
| 100K–1M | Message queue, CDN for all media, PgBouncer connection pooling |
| 1M+ | Regional sharding, dedicated search (Meilisearch/Algolia), multi-region DB |

---

## 11. Build Playbook: Phase-by-Phase Prompts

Run these **in order**, in the same Claude Code session, inside your project folder. Commit after each phase (see [Section 13](#13-git-workflow-per-phase)).

### Phase 0 — Init the project

```bash
mkdir event-ticketing-platform && cd event-ticketing-platform
git init
claude
```

Then in Claude Code:
```
/init
```
> See [Section 12](#12-using-init-and-claudemd) — this scans your (currently empty) repo and creates a CLAUDE.md that Claude Code reads automatically in every future session. Re-run `/init` after Phase 1 once real code exists, so it captures actual structure and conventions.

---

### Phase 1 — Scaffold & Database

```
/model claude-sonnet-5

Set up the monorepo structure for a Next.js 15 + Elysia + 
Supabase project (apps/web, apps/api, packages/types, 
packages/database). Create package.json, tsconfig.json, 
.env.example, .gitignore for each.

Then create the complete PostgreSQL schema exactly as 
specified in this architecture doc [paste Section 2 here], 
including all tables, RLS policies, triggers, and indexes.
Save it as supabase/migrations/0001_init.sql.
```

**Commit after this phase.**

---

### Phase 2 — Backend: Auth + Core Middleware

```
/model claude-sonnet-5

Build the Elysia backend foundation in apps/api:
- src/index.ts (server entry)
- src/middleware/auth.ts (JWT verification, role checks, 
  reads current user.status from DB on every request)
- src/middleware/rateLimiter.ts (per the rate limits in 
  Section 6 of the architecture doc)
- src/routes/auth.ts: register, login, logout, refresh-token, 
  forgot-password
- src/database/client.ts (Supabase client)
- src/lib/jwt.ts (separate signing functions for auth tokens 
  vs QR tokens, per Section 6)

Use the API contract standard from Section 5 for all 
responses (success/error shape).
```

**Commit after this phase.**

---

### Phase 3 — Backend: Events, Ticket Types, Search

```
/model claude-sonnet-5

Build event and ticket-type routes in apps/api/src/routes/events.ts:
- GET /events (full-text search via search_vector, city filter, 
  cursor pagination — see Section 4/5)
- GET /events/:id
- POST /events (organizer only, must be verification_status=approved 
  checked server-side, captures organizer_status_snapshot)
- PUT /events/:id (owner only, version-checked if tickets sold)
- DELETE /events/:id
- POST /events/:id/media (Cloudinary upload with magic-number 
  validation and moderation API per Section 6)
- Ticket type CRUD under /events/:id/ticket-types

Respect the RLS policies already in the schema — don't 
duplicate authorization logic that the DB already enforces, 
but do add explicit checks where RLS can't (e.g. business 
rules like organizer approval status).
```

**Commit after this phase.**

---

### Phase 4 — Backend: Reservations, Payments, Refunds

```
/model claude-sonnet-5

This is the most critical phase — implement with full 
transaction safety per Section 9 (Failure Mode Table).

Build in apps/api/src/routes/:
1. tickets.ts
   - POST /events/:id/reserve — creates a reservation 
     (SELECT FOR UPDATE on ticket_descriptions, decrement 
     available_tickets, 10-min expiry) per Section 2 schema
   - A background job (or Supabase cron) that expires 
     reservations past reservation_expires_at and restores 
     available_tickets

2. payments.ts
   - POST /payments/create-order (Razorpay order creation)
   - POST /payments/verify (HMAC-SHA256 signature check, 
     idempotent via razorpay_payment_id unique constraint, 
     wraps payment→ticket→QR creation in a single DB transaction)
   - POST /payments/webhook (source of truth, same idempotent 
     confirmPayment() function as /verify)
   - Reconciliation job: finds captured payments with no ticket, 
     auto-repairs, alerts admin

3. refunds.ts
   - POST /tickets/:id/cancel (applies refund_policy from events.refund_policy)
   - POST /events/:id/cancel (organizer/admin, bulk refund all tickets)

4. verification.ts
   - POST /tickets/verify (QR JWT decode, atomic status 
     valid→invalid transition, rejects already-scanned tickets)

Queue confirmation emails and notifications via BullMQ 
(email-queue, notification-queue) — do not block these routes 
on email/SMS sending, per Section 3.
```

**Commit after this phase.**

---

### Phase 5 — Backend: Organizer & Admin Routes

```
/model claude-sonnet-5

Build in apps/api/src/routes/:
1. organizers.ts
   - POST /organizers/upgrade (KYC upload, sets verification_status=pending)
   - GET /organizers/my-profile
   - PUT /organizers/profile

2. admin.ts
   - GET /admin/users, PUT /admin/users/:id/status
   - GET /admin/organizers/pending
   - PUT /admin/organizers/:id/approve (optimistic lock via 
     version column, per Section 9)
   - PUT /admin/organizers/:id/reject
   - GET /admin/events, GET /admin/dashboard

Every admin mutation must write to the audit_logs table 
(admin_user_id, action_type, target_table, target_id, 
old_value, new_value, ip_address) per Section 6.
```

**Commit after this phase.**

---

### Phase 6 — Frontend: Pages & Layout

```
/model claude-sonnet-5

Scaffold apps/web using the page structure below. Use 
Next.js 15 App Router, TypeScript, TailwindCSS.

Public: app/page.tsx, app/events/page.tsx, app/events/[id]/page.tsx
Auth: app/auth/login, register, forgot-password
User (protected): dashboard, tickets/[id], bookings
Organizer (protected): profile, upgrade, events, events/create, 
  events/[id], events/[id]/analytics, events/[id]/verify
Admin (protected): dashboard, users, organizers, events

Include a ProtectedRoute wrapper that checks role + 
user.status, and the shared layout/navbar with role-based menu.
```

---

### Phase 7 — Frontend: Components & Hooks

```
/model claude-sonnet-5

Generate all components and hooks for apps/web following 
the API contract in Section 5 (handle {success, data, error} 
shape generically in a shared apiClient).

Components: EventCard, EventFilter, EventSearch, EventMap 
(Mapbox), TicketTypeForm, TicketCard, QRCode, QRScanner, 
PaymentModal (Razorpay), OrganizerUpgradeForm, EventForm, 
EventAnalyticsChart, AttendeeCheckIn, UsersList, 
OrganizerApprovalPanel.

Hooks: useAuth, useSupabase, useEvents, useTickets, 
usePayment, useMap, useQRCode, useOrganizer, useAdmin.

Handle reservation expiry UX: when POST /events/:id/reserve 
succeeds, start a visible 10-minute countdown; on expiry, 
release the UI back to "buy" state.
```

---

### Phase 8 — Integration Testing & Load Test

```
/model claude-sonnet-5

Write:
1. Integration tests for the full payment flow (mocked 
   Razorpay): order → webhook → ticket creation, and a 
   duplicate-webhook test proving idempotency.
2. RLS policy tests: confirm organizer A cannot query 
   organizer B's tickets/payments.
3. A k6 load test script simulating 10,000 concurrent users 
   buying the last 100 tickets of an event. Success criteria: 
   exactly 100 tickets sold, zero overselling, p95 < 2s.

Save tests under apps/api/tests and load-tests/.
```

**Commit after this phase.**

---

## 12. Using `/init` and CLAUDE.md

`/init` is a built-in Claude Code command that scans your project and generates a `CLAUDE.md` file at the repo root. Claude Code automatically reads this file at the start of every future session in this project — it's how Claude "remembers" your conventions without you re-explaining them each time.

**When to run it:**
- **Once at the very start** (Phase 0), even on an empty repo — it sets up a baseline file.
- **Again after Phase 1**, once the monorepo structure and schema exist — this is when it becomes genuinely useful, since it can document real folder structure, naming conventions, and commands.
- **Again anytime the project structure changes significantly** (e.g., after adding the queue system in Phase 4).

**What to do after `/init` runs:**
Open the generated `CLAUDE.md` and add project-specific rules Claude Code should always follow, for example:

```markdown
## Project-Specific Rules
- Always use SELECT ... FOR UPDATE when touching available_tickets
- Never bypass RLS — add policies instead of app-level-only checks
- All payment/ticket writes must be inside a DB transaction
- Use the shared apiClient response shape from Section 5 for every route
- Queue emails/SMS via BullMQ — never send them synchronously in a request
- Run `bun test` before every commit
```

This turns your architecture doc's rules into something Claude Code actively enforces in every subsequent phase, instead of you re-pasting constraints each time.

---

## 13. Git Workflow Per Phase

At the end of each phase, ask Claude Code to commit directly:

```
Stage and commit all changes from this phase with a clear, 
conventional commit message (e.g. "feat: add reservation and 
payment transaction handling"). Show me the diff summary 
before committing.
```

Claude Code will run `git add`, show you what changed, and commit. Recommended commit message pattern per phase:

| Phase | Suggested commit message |
|---|---|
| 0 | `chore: init project structure and CLAUDE.md` |
| 1 | `feat: add database schema with RLS, triggers, and indexes` |
| 2 | `feat: add auth middleware, JWT, and rate limiting` |
| 3 | `feat: add event, ticket-type, and search routes` |
| 4 | `feat: add reservation, payment, and refund transaction flow` |
| 5 | `feat: add organizer and admin routes with audit logging` |
| 6 | `feat: scaffold frontend pages and protected routing` |
| 7 | `feat: add components and hooks for booking flow` |
| 8 | `test: add integration tests and load test for ticket drops` |

After the final phase, tag the release:
```
Create a git tag "v0.1.0-mvp" for this commit and push to 
origin if a remote is configured.
```

---

*End of document. This file is meant to live at the root of your repo (e.g. `docs/architecture.md`) alongside `CLAUDE.md`, so both you and Claude Code can reference it throughout the build.*
