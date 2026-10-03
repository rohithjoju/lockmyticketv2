# CLAUDE.md

Event ticketing platform. Multi-tenant. Roles: attendee, organizer, admin.
Full specification: @docs/SPEC.md — read it before non-trivial changes.

Stack: Next.js 15 (App Router) · Elysia (Bun) · Supabase (PostgreSQL) · Razorpay ·
Cloudinary · Mapbox · Redis/BullMQ.

The commercially critical path is: **reserve → pay → confirm → issue QR → scan at door.**
Anything that looks over-engineered exists to protect that path.

## Global Rules (NON-NEGOTIABLE — SPEC §2)

Violating any of these is a defect even if tests pass.

- **R1 — Inventory is sacred.** Any read of `ticket_descriptions.available_tickets` that
  leads to a write MUST use `SELECT ... FOR UPDATE` inside a transaction. Never decrement
  inventory from a cached or previously-read value. Go through `reserve_tickets()` /
  `expire_reservations()`.
- **R2 — Money operations are transactional.** Payment confirmation, ticket issuance, and
  inventory changes happen in ONE database transaction. If any step fails, all roll back.
- **R3 — Money operations are idempotent.** Any handler invokable twice (webhooks, retries)
  produces the same result with no duplicate side effects. Idempotency anchors on
  `payments.razorpay_payment_id` (UNIQUE).
- **R4 — Authorization lives in the database.** RLS policies are the primary enforcement.
  Application-level checks are a second layer, never the only layer.
- **R5 — Never block a request on a third party you don't control.** Email, SMS, push, and
  analytics go to a queue. Only Razorpay verification and Supabase writes may be synchronous.
- **R6 — All timestamps are `timestamptz`, stored in UTC.** Convert to local time only at
  render. Never store a naive timestamp.
- **R7 — Event status is computed, never stored.** Derive `upcoming`/`ongoing`/`past` from
  `start_time`/`end_time` via `events_with_status`.
- **R8 — Two separate JWT secrets.** `JWT_SECRET` for auth tokens, `QR_JWT_SECRET` for ticket
  QR codes. Never reuse one for the other.
- **R9 — Every response uses the envelope in §6.1.** No bare objects, no bare arrays, no
  inconsistent error shapes.
- **R10 — Every admin mutation writes to `audit_logs`.** No exceptions.
- **R11 — No secrets in code.** Everything from `process.env`, validated at boot
  (`packages/config`). Fail fast on missing vars.
- **R12 — Validate at the boundary.** Every route defines an Elysia schema for body/params/
  query. No unvalidated input reaches business logic.

## Anti-patterns — do NOT do these (SPEC §2)

| ❌ Don't | ✅ Do instead |
|---|---|
| `if (available > 0) { decrement() }` in app code | Call the `reserve_tickets()` DB function |
| Create tickets in the `/payments/verify` HTTP handler | Call shared `confirmPayment()` used by both verify and webhook |
| Trust `req.body.userId` | Read user identity from the verified JWT only |
| Store `status: 'upcoming'` on events | Use the `events_with_status` view |
| `await sendEmail()` inside a purchase route | `await emailQueue.add(...)` |
| Use `LIKE '%term%'` for search | Use `search_vector @@ to_tsquery(...)` |
| Return `res.status(500).json({msg: e.message})` | Return the envelope with a registered error code |
| Check role only in the frontend | RLS policy + middleware check + frontend guard |

## Layering

- `routes/` → validate input, call a service, return the envelope. No business logic.
- `services/` → all business logic. No HTTP concerns.
- `db/` → Supabase client + transaction helper only.

## Commands

```
bun run dev        # api + web
bun test           # all tests
bun run test:e2e   # playwright e2e tests
bun run typecheck
supabase migration up
```

## Before every commit

```
bun run typecheck && bun test
```
