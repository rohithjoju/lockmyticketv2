# Completed TODOs

## Epic 1: Checkout & Timer (P0)
- **1.1 Reserve tickets mutation:** `useReservation.ts` hook created, wrapping `POST /events/:id/reserve`.
- **1.2 10-minute countdown lock:** `ReservationTimer.tsx` implemented. Flashes red when under 60s, Auto-releases on expiry.
- **1.3 Payment integration:** `usePayment.ts` created with Razorpay `checkout.js`. Integrated order creation and verification.
- **1.4 Booking CTA component:** `BookingCta.tsx` completely rewritten to support ticket type selection, quantity constraints (`min(avail, 10)`), real-time pricing, and the full reserve-timer-pay flow.

## Epic 2: Attendee Dashboard (P0)
- **2.1 Anti-screenshot QR modal:** `TicketQRModal.tsx` created. Uses `qrcode.react`, fetches `qrToken`, displays UTC pulse clock. Handles Checked-in and Refunded states.
- **2.2 Refund request modal:** `TicketRefundModal.tsx` created. Fetches refund policy, calculates expected refund (full/partial), handles double confirmation, and calls `POST /tickets/:id/refund`.
- **2.3 Dashboard UI wiring:** Modified `dashboard/page.tsx` to include "Show QR" and "Request Refund" buttons in the `TicketStub` component.

## Epic 3: Organizer Onboarding (P0)
- **3.1 Upgrade form:** `organizer/upgrade/page.tsx` implemented. Handles `multipart/form-data` with magic byte validation for the KYC PDF.
- **3.2 Status dashboard:** `organizer/status/page.tsx` created. Displays pending/approved/rejected status, rejection reasons, and provides a re-apply flow.

## Epic 4: Organizer Dashboard (P1)
- **4.1 Events list:** `organizer/events/page.tsx` implemented. Shows quick metrics, status badges, and action links.
- **4.2 Event create/edit forms:** `EventForm.tsx` handles both creation and editing. Includes location inputs, dates, refund policies, and a poster image upload via `POST /events/:id/media`. Added a cancel event flow with bulk-refund warnings.
- **4.3 Ticket tier configuration:** `TicketTypeForm.tsx` implemented. Allows adding ticket types with capacity guards.
- **4.4 Analytics dashboard:** `organizer/events/[id]/analytics/page.tsx` implemented. Renders KPI cards, sales by tier, and a daily sales timeline.
- **4.5 Attendee roster (PII safe):** `organizer/events/[id]/attendees/page.tsx` implemented. Searchable table of attendees (name, tier, check-in status). Email/Phone are kept fully masked.
- **4.6 Door QR scanner:** `organizer/events/[id]/scan/page.tsx` implemented. Uses `html5-qrcode` to scan `qrToken`, calls verification endpoint, provides color-coded feedback and a history log of recent scans.

## Epic 5: Admin Panel (P1)
- **5.1 Platform overview:** `admin/page.tsx` implemented with comprehensive KPIs (Users, Events, Revenue, Success Rate).
- **5.2 User governance:** `admin/users/page.tsx` implemented with pagination, role/status filtering, and an active/disabled toggle (with self-disable guards).
- **5.3 Organizer verification queue:** `admin/organizers/page.tsx` implemented. Shows pending KYC apps. Implemented Optimistic Locking (versioning) on approve/reject, and reason-entry for rejection.
- **5.4 Events moderation:** `admin/events/page.tsx` implemented as a read-only platform-wide log of events.
- **5.5 Audit trail explorer:** `admin/audit-logs/page.tsx` implemented with filtering. Shows JSON diffs of `oldValue` vs `newValue` with IP/RequestId context.

## Epic 6: Mapbox Map (P2)
- **6.1 TicketMap Component:** `TicketMap.tsx` implemented. Loads map via `mapbox-gl` safely, uses non-interactive static view to prevent scroll hijacking, includes a fallback state if token is missing.

## Epic 7: Background Workers (P2)
- **7.1 Email provider wiring:** Updated `email.worker.ts` to implement `Resend` emails with a graceful logging fallback if `RESEND_API_KEY` is not present.
- **7.2 Media housekeeping:** Updated `media.worker.ts` to mock asset cleanup. Resolves active DB URLs and checks for orphans (deletion disabled as requested by spec, but logic is complete).

## Epic 8 & 9: Testing & Scaling
- **8.1 & 8.2 Automation test cases:** Built complete Playwright E2E suites under `tests/automation/`:
  - `epic1-epic2-booking-wallet.spec.ts`: Interactive Booking CTA, real-time pricing calculation, reservation hold timer, Razorpay checkout transitions, Ticket QR modal (with UTC pulse clock & admission badges), and refund modal policy calculation with double confirmation.
  - `epic3-epic4-organizer-ops.spec.ts`: Organizer upgrade application with KYC PDF upload & magic bytes validation, review tracking on status page, events listing with quick metrics, event creation & editing with ticket tiers, analytics dashboard, attendee roster with PII protection, and door QR camera scanner UI.
  - `epic5-admin-governance.spec.ts`: Platform overview dashboard, user governance with self-disable safety guard, organizer approval queue with KYC link & rejection reason prompt, platform-wide event moderation, and audit trail explorer with expandable JSON diffs.
- **8.3 Load tests:** Created `k6-load.js` script to test high concurrent reservations.
- **9.1 Scalability roadmap:** Created `SCALING.md` highlighting Redis caching, PgBouncer, Meilisearch, and event-driven architectures.
