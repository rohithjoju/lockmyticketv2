# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Attendees**: Eventgoers across India discovering live events, securing high-demand seats without fear of cart loss, paying via Razorpay, and presenting secure offline/online QR codes at the gate.
- **Organizers**: Event creators and promoters managing ticket allocations, pricing tiers, KYC/organization profile, on-ground door verification via QR scanning, and sales analytics. Requires administrative approval.
- **Admins**: Platform operators reviewing organizer applications, monitoring audit logs, resolving disputes, and issuing refunds.

## Product Purpose

A rock-solid, multi-tenant live event ticketing platform where tickets are reserved with strict database atomicity. The core promise is eliminating cart snatches and concurrency races during ticket drops, ensuring fairness, transparency, and reliable door admissions.

## Positioning

"Nobody sells your seat while you pay." Unlike standard platforms where seats can slip away during checkout or double-book under peak load, LockMyTicket guarantees a strict 10-minute hold window backed by PostgreSQL row locking (`SELECT ... FOR UPDATE`) and atomic inventory restoration.

## Operating Context

- High-concurrency ticket drops and peak purchase spikes.
- Live checkout flows constrained to a 10-minute countdown timer.
- On-venue gate operations requiring fast single-use QR ticket verification on mobile devices.
- Desktop and mobile web access for attendees, venue door staff, and desktop admin operators.

## Capabilities and Constraints

- Next.js 15 App Router frontend paired with Elysia.js (Bun) API and Supabase (PostgreSQL).
- Atomic inventory reservation function (`reserve_tickets`) with TTL expiration worker.
- Razorpay payment integration with idempotent webhook processing and signed JWT ticket QR generation.
- Role-based workflows (Attendee, Organizer, Admin) strictly guarded with database Row Level Security (RLS).
- Maximum 10 tickets per user per event cap.

## Brand Commitments

- Name: LockMyTicket / Event Ticketing Platform.
- Core Hook: "Nobody sells your seat while you pay."
- Tone: Dependable, crisp, high-integrity, fast, non-deceptive. Avoid dark patterns or artificial countdown anxiety.

## Evidence on Hand

- Complete architectural and database specification in `docs/SPEC.md`.
- Next.js 15 web client in `apps/web/` featuring the live ticket hold stub and event catalog.
- Backend services, migrations, and Playwright E2E suites verifying atomic authentication and flows.

## Product Principles

1. **Inventory is sacred**: Never show false availability or permit overbooking; reservations are committed atomically at the database layer.
2. **Transparent hold window**: The 10-minute checkout timer is literal and binding—never fake, extended arbitrarily, or shortened unannounced.
3. **Frictionless gate redemption**: Valid tickets scan instantly at the door and transition deterministically into single-use redeemed status.
4. **Resilient under pressure**: Clear fallbacks, clean error handling, and robust zero-jitter interactions during high-traffic moments.

## Accessibility & Inclusion

- WCAG 2.1 AA compliance across all buyer checkout steps and form inputs.
- Clear high-contrast timers, error announcements, and full keyboard navigability throughout seat selection, payment, and ticket retrieval.
