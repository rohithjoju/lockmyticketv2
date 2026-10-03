# Event Ticketing Platform — Implementation Roadmap & TODOs

This file tracks all features, functionalities, and test suites deferred from earlier phases or marked as **"Next Release"**, scheduled for **Phase 7 (Dashboards & Booking)**, **Phase 8 (Verification & Load Testing)**, and future production milestones.

Tasks are structured with concrete file paths, API contracts, error boundaries, and acceptance criteria to enable autonomous agentic IDE execution.

---

## Table of Contents
1. [Epic 1: Attendee Reservation & Razorpay Payment Flow](#epic-1-attendee-reservation--razorpay-payment-flow-phase-7---p0)
2. [Epic 2: Digital Ticket Wallet & Cryptographic QR Codes](#epic-2-digital-ticket-wallet--cryptographic-qr-codes-phase-7---p0)
3. [Epic 3: Organizer Onboarding & KYC Application Form](#epic-3-organizer-onboarding--kyc-application-form-phase-7---p1)
4. [Epic 4: Organizer Dashboard, Event Management & Door Scanner](#epic-4-organizer-dashboard-event-management--door-scanner-phase-7---p1)
5. [Epic 5: Admin Governance, Moderation & Audit Panels](#epic-5-admin-governance-moderation--audit-panels-phase-7---p1)
6. [Epic 6: Mapbox Geographic Event Discovery](#epic-6-mapbox-geographic-event-discovery-phase-7---p2)
7. [Epic 7: Production Worker Integrations (Email & Media Cleanup)](#epic-7-production-worker-integrations-email--media-cleanup-deferred---p2)
8. [Epic 8: Phase 8 Verification, Multi-Tenant RLS & k6 Load Tests](#epic-8-phase-8-verification-multi-tenant-rls--k6-load-tests-phase-8---p0)
9. [Epic 9: Scalability Roadmap](#epic-9-scalability-roadmap-architecture-10)

---

## Epic 1: Attendee Reservation & Razorpay Payment Flow (Phase 7 - P0)

Currently, `apps/web/src/components/BookingCta.tsx` renders a disabled button stating *"Booking opens in the next release."* The backend reservation and payment verification APIs are fully functional (`POST /events/:id/reserve`, `POST /payments/order`, `POST /payments/verify`).

- [ ] **1.1 Build Reservation Hook (`apps/web/src/hooks/useReservation.ts`)**
  - [ ] Implement `useReservation(eventId: string)` using `@tanstack/react-query` mutations.
  - [ ] Action: `reserveTickets(ticketDescriptionId: string, quantity: number)`:
    - Calls `POST /api/v1/events/:id/reserve`.
    - Handles error codes: `TICKET_SOLD_OUT` (409), `TICKET_LIMIT_EXCEEDED` (409, max 10/user), `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401).
    - Returns `{ ticketIds: string[], expiresAt: string }`.
  - [ ] Action: `releaseReservation(ticketId: string)`:
    - Calls `DELETE /api/v1/reservations/:id`.
    - Restores inventory when user abandons or timer expires.

- [ ] **1.2 Build 10-Minute Countdown Timer Component (`apps/web/src/components/ReservationTimer.tsx`)**
  - [ ] Receive `expiresAt` (ISO UTC timestamptz) and calculate remaining `mm:ss`.
  - [ ] When time remaining <= 60s, change tone to warning/urgent.
  - [ ] On countdown expiration (`00:00`):
    - Automatically call `releaseReservation` for held ticket IDs.
    - Trigger `onExpired` callback to reset UI back to "Reserve" state.
    - Render alert notice: *"Reservation expired. Seats have been returned to inventory."*

- [ ] **1.3 Build Razorpay Payment Hook & Modal (`apps/web/src/hooks/usePayment.ts`, `apps/web/src/components/PaymentModal.tsx`)**
  - [ ] Dynamically load `https://checkout.razorpay.com/v1/checkout.js`.
  - [ ] Action: `createPaymentOrder(ticketIds: string[])`:
    - Calls `POST /api/v1/payments/order`.
    - Returns `{ orderId: string, amount: number, currency: string }`.
  - [ ] Configure Razorpay modal options:
    - Key: `NEXT_PUBLIC_RAZORPAY_KEY_ID`.
    - Prefill: `user.name`, `user.email`.
    - Dismiss handler (`modal.ondismiss`): Do not claim success; keep timer running so attendee can retry before `expiresAt`.
  - [ ] Action: `verifyPayment(response: RazorpayPaymentResponse)`:
    - Calls `POST /api/v1/payments/verify` with `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`.
    - Handles error codes: `INVALID_SIGNATURE` (400), `PAYMENT_EXPIRED` (400), `PAYMENT_FAILED` (400).
    - On success: Navigate to `/dashboard` with query `?booked=true`.

- [ ] **1.4 Wire Up Booking UI in Event Detail Page (`apps/web/src/components/BookingCta.tsx`)**
  - [ ] Replace placeholder stub with interactive ticket quantity selector (+ / - up to `availableTickets` or 10 max).
  - [ ] Render total price calculation updating in real time.
  - [ ] When reserved, display `<ReservationTimer />` and open `<PaymentModal />`.

---

## Epic 2: Digital Ticket Wallet & Cryptographic QR Codes (Phase 7 - P0)

Currently, `apps/web/src/app/(protected)/dashboard/page.tsx` renders static ticket stubs with note: *"The QR view for a confirmed ticket lands in Phase 7; the stub is read-only for now."*

- [ ] **2.1 Build Cryptographic QR Display Component (`apps/web/src/components/TicketQRModal.tsx`)**
  - [ ] Install or utilize canvas/SVG QR generator (e.g. `qrcode.react`).
  - [ ] Fetch signed token via `GET /api/v1/tickets/:id` (`ticket.qrToken`).
  - [ ] Render dynamic QR code encoding `qrToken` (zero PII payload: `{ tid, eid, nonce }`).
  - [ ] Display anti-screenshot dynamic pulse / live UTC clock beneath the QR to prevent spoofing.
  - [ ] Show admission state:
    - **Ready** (valid, unverified): Green badge, prominent QR.
    - **Checked in** (verified): Muted badge, crossed-out QR with check-in timestamp (`verifiedAt`).
    - **Refunded / Cancelled**: Red badge, QR disabled.

- [ ] **2.2 Implement Ticket Cancellation & Refund Request UI (`apps/web/src/components/TicketRefundModal.tsx`)**
  - [ ] On ticket stub in dashboard, add "Request Refund" action button for confirmed tickets.
  - [ ] Calculate and display expected refund percentage based on event's `refundPolicy`:
    - Full refund if > `full_refund_hours` before event start.
    - Partial refund percent if within partial refund window.
    - Disabled if event has started (`REFUND_WINDOW_CLOSED`).
  - [ ] Confirming calls `POST /api/v1/tickets/:id/refund`.
  - [ ] Handle error states: `REFUND_WINDOW_CLOSED` (400), `REFUND_ALREADY_ISSUED` (409), `EVENT_CANCELLED` (400).
  - [ ] Update ticket state to `cancelled` and invalidate react-query cache `['tickets']`.

---

## Epic 3: Organizer Onboarding & KYC Application Form (Phase 7 - P1)

Currently, `apps/web/src/app/(protected)/organizer/upgrade/page.tsx` displays `NextRelease` with *"The API already takes applications and KYC documents. The form for them lands with the organizer dashboards in the next release."*

- [ ] **3.1 Build Organizer Application Page (`apps/web/src/app/(protected)/organizer/upgrade/page.tsx`)**
  - [ ] Form fields:
    - `organizationName` (required, text, min 2 chars).
    - `contactNumber` (required, phone format, exactly 10 digits validation).
    - `address` (optional, text).
    - `description` (required, textarea, min 20 chars).
    - `kycDocument` (required file input, PDF only, max 10MB).
  - [ ] Client-side validation:
    - Validate magic bytes `%PDF-` on selected file before upload.
    - Reject files > 10MB immediately.
  - [ ] Submit handler:
    - Dispatches `POST /api/v1/organizers/upgrade` as `multipart/form-data`.
    - Handles `VALIDATION_FAILED` (400), `ORGANIZER_ALREADY_EXISTS` (409).
    - On success: Refresh user profile (`useAuth.reload()`), redirect to `/dashboard` showing *"Your organizer application is under review"*.

- [ ] **3.2 Organizer Application Status Page (`apps/web/src/app/(protected)/organizer/status/page.tsx`)**
  - [ ] View submitted organization details and current status (`pending`, `approved`, `rejected`).
  - [ ] If `rejected`: Show `rejection_reason` and provide a "Re-apply" button resetting the form with version increment.

---

## Epic 4: Organizer Dashboard, Event Management & Door Scanner (Phase 7 - P1)

Currently, `apps/web/src/app/(protected)/organizer/events/page.tsx` renders `NextRelease` with *"Creating events, selling ticket types, scanning at the door and reading analytics all arrive together in the next release."*

- [ ] **4.1 Build Organizer Events List (`apps/web/src/app/(protected)/organizer/events/page.tsx`)**
  - [ ] Query events created by current organizer (`GET /api/v1/events?organizerId=...`).
  - [ ] Render event cards with status badges (`upcoming`, `ongoing`, `past`, `cancelled`).
  - [ ] Display quick metrics per card: total tickets sold, revenue, capacity percentage.
  - [ ] Provide action links: "Create New Event", "Edit Event", "Analytics", "Door Scanner", "Attendee Roster".

- [ ] **4.2 Build Event Create & Edit Form (`apps/web/src/app/(protected)/organizer/events/create/page.tsx` & `[id]/edit/page.tsx`)**
  - [ ] Form fields:
    - Title, event type (`music`, `tech`, `arts`, `food`, etc.).
    - Description (with sanitized Markdown/HTML preview).
    - Location name, street address, city (autocomplete/dropdown for major Indian cities).
    - Start date/time & End date/time (validation: `end_time > start_time`).
    - Poster image upload (via `POST /api/v1/media/upload` with magic byte validation).
    - Refund policy: `full_refund_hours` (default 48), `partial_refund_percent` (default 50).
    - Terms and conditions text.
  - [ ] Actions:
    - Create: `POST /api/v1/events`.
    - Update: `PATCH /api/v1/events/:id`.
    - Cancel Event: `POST /api/v1/events/:id/cancel` with confirmation modal alerting that all active tickets will be refunded in bulk.

- [ ] **4.3 Build Ticket Tier Configuration Component (`apps/web/src/components/TicketTypeForm.tsx`)**
  - [ ] Add / Edit ticket tiers for an event (`POST /api/v1/events/:id/ticket-types`).
  - [ ] Fields: Tier name (General, VIP, Early Bird), description, price (INR), total tickets.
  - [ ] Guard against decreasing capacity below already sold tickets.

- [ ] **4.4 Build Event Analytics Dashboard (`apps/web/src/app/(protected)/organizer/events/[id]/analytics/page.tsx`)**
  - [ ] Call `GET /api/v1/events/:id/analytics`.
  - [ ] Key metrics cards:
    - Total tickets sold vs capacity.
    - Gross revenue collected.
    - Check-in rate (% of confirmed attendees admitted).
  - [ ] Sales breakdown by tier (`byTicketType` table/bar chart).
  - [ ] Cumulative sales timeline chart (`byDate`).

- [ ] **4.5 Build Attendee Roster View (`apps/web/src/app/(protected)/organizer/events/[id]/attendees/page.tsx`)**
  - [ ] Call `GET /api/v1/events/:id/attendees`.
  - [ ] Searchable, paginated table showing attendee name, ticket tier, check-in status, and `verifiedAt`.
  - [ ] Strict PII enforcement: Verify that email and phone number are never requested or rendered (per SPEC §8).

- [ ] **4.6 Build Door Check-in & Camera QR Scanner (`apps/web/src/app/(protected)/organizer/events/[id]/scan/page.tsx`)**
  - [ ] Access device camera using standard media streams (leveraging `next.config.ts` camera permission policy).
  - [ ] Scan and parse QR code in real-time.
  - [ ] Call `POST /api/v1/tickets/verify` with `{ qrToken }`.
  - [ ] Render instant visual + audio feedback:
    - **Success (200):** Green banner, attendee name, ticket tier, "Admitted".
    - **Duplicate Scan (409 `TICKET_ALREADY_USED`):** Red flash, warning sound, "Already Used at [time]".
    - **Invalid / Tampered (401/404):** Error banner, "Invalid Ticket Signature".
  - [ ] Maintain local scan history log of last 50 scans for fast auditing at entry gates.

---

## Epic 5: Admin Governance, Moderation & Audit Panels (Phase 7 - P1)

Currently, `apps/web/src/app/(protected)/admin/page.tsx` renders `NextRelease` stating *"Admin panels arrive next — Users, the organizer approval queue, every event and the audit trail are already live on the API. Their screens come with the next release."*

- [ ] **5.1 Build Admin Dashboard Overview (`apps/web/src/app/(protected)/admin/page.tsx`)**
  - [ ] Call `GET /api/v1/admin/dashboard`.
  - [ ] Display platform KPI summary cards:
    - Total users (attendees vs organizers).
    - Pending organizer approval queue count.
    - Active events vs flagged events.
    - Total GMV / Platform Revenue.
    - Payment gateway success rate (`payments.successRate`).

- [ ] **5.2 Build User Governance Panel (`apps/web/src/app/(protected)/admin/users/page.tsx`)**
  - [ ] Paginated user list via `GET /api/v1/admin/users?role=&status=&cursor=`.
  - [ ] Search by email or name.
  - [ ] Action: Disable / Re-enable user account (`PATCH /api/v1/admin/users/:id/status` with `{ status: 'active' | 'disabled' }`).
  - [ ] Safety guard: Disable button disabled for current logged-in admin user to prevent self-lockout.

- [ ] **5.3 Build Organizer Verification Queue (`apps/web/src/app/(protected)/admin/organizers/page.tsx`)**
  - [ ] Call `GET /api/v1/admin/organizers/pending`.
  - [ ] Render pending applications with organization name, contact number, description, and link to view uploaded KYC PDF.
  - [ ] Action: Approve Application:
    - Calls `POST /api/v1/admin/organizers/:id/approve` with `{ version }`.
    - Handles `VERSION_CONFLICT` (409) if another admin approved/rejected concurrently.
  - [ ] Action: Reject Application:
    - Modal prompting for mandatory `reason` text.
    - Calls `POST /api/v1/admin/organizers/:id/reject` with `{ version, reason }`.

- [ ] **5.4 Build Global Events Moderation Panel (`apps/web/src/app/(protected)/admin/events/page.tsx`)**
  - [ ] Call `GET /api/v1/admin/events`.
  - [ ] Filter by status, flagged status, or city.
  - [ ] Action: Flag/Unflag event for admin review (`PATCH /api/v1/admin/events/:id/flag`).
  - [ ] Action: Force Cancel event with bulk refund trigger (`POST /api/v1/admin/events/:id/cancel`).

- [ ] **5.5 Build Audit Trail Explorer (`apps/web/src/app/(protected)/admin/audit-logs/page.tsx`)**
  - [ ] Call `GET /api/v1/admin/audit-logs?cursor=&targetTable=&actorUserId=`.
  - [ ] Paginated data table showing:
    - Timestamp (localized via `<LocalTime />`).
    - Admin actor email.
    - Action type (`user.disabled`, `organizer.approved`, `event.flagged`, etc.).
    - Target table & Target UUID.
    - Collapsible JSON diff viewer comparing `old_value` and `new_value`.
    - Client IP address.

---

## Epic 6: Mapbox Geographic Event Discovery (Phase 7 - P2)

Currently, event browsing (`apps/web/src/app/events/page.tsx`) is a grid list without map visualization.

- [ ] **6.1 Build Mapbox Event Map Component (`apps/web/src/components/EventMap.tsx`)**
  - [ ] Integrate Mapbox GL JS using `NEXT_PUBLIC_MAPBOX_TOKEN`.
  - [ ] Restrict bounds and default center to India (`[68.1, 6.5, 97.4, 35.5]`).
  - [ ] Geocode event locations or plot events with `latitude` and `longitude`.
  - [ ] Interactive markers: clicking a pin opens a popup showing event thumbnail, title, venue, price, and "View Event" button.
  - [ ] Synchronize map pins with active search & city filters from the browse page.

---

## Epic 7: Production Worker Integrations (Email & Media Cleanup) (Deferred - P2)

The BullMQ workers in `apps/api/src/queues/` have scaffolding and error retry handlers, but 3rd-party provider integrations are deferred stubs.

- [ ] **7.1 Wire Transactional Email Provider (`apps/api/src/queues/email.worker.ts`)**
  - [ ] Integrate email delivery service (Resend / SendGrid / AWS SES) using env variable `EMAIL_API_KEY`.
  - [ ] Implement email HTML templates:
    - Ticket purchase confirmation with order summary and receipt link.
    - Organizer application approved notification.
    - Organizer application rejected notification with `rejection_reason`.
    - Event cancellation and full refund confirmation.
  - [ ] Enforce SPEC §8: Ensure no raw sensitive user payloads or tokens are logged during worker execution.

- [ ] **7.2 Implement Automated Media Housekeeping (`apps/api/src/queues/media.worker.ts`)**
  - [ ] Replace placeholder logging with active orphan detection query:
    - Query Cloudinary assets uploaded > 24 hours ago.
    - Check against database references (`events.poster_url`, `events.images_urls`, `organizers.kyc_document_url`).
    - Delete verified unreferenced assets via Cloudinary Admin API.
  - [ ] Add unit test ensuring no active event poster is mistakenly identified as orphaned.

---

## Epic 8: Phase 8 Verification, Multi-Tenant RLS & k6 Load Tests (Phase 8 - P0)

Per SPEC §11 Phase 8, the following verification suites must be executed before final release tagging (`git tag v1.0.0-mvp`):

- [ ] **8.1 Multi-Tenant RLS Isolation Tests (`tests/integration/rls.test.ts`)**
  - [ ] Test: Organizer A cannot query Organizer B's ticket sales, payments, or analytics directly via Supabase client.
  - [ ] Test: Attendee A cannot access or decrypt Attendee B's tickets or QR codes.
  - [ ] Test: Non-admin users cannot read from `audit_logs` or execute admin RPCs.

- [ ] **8.2 System Failure Mode & Crash-Recovery Suite (`tests/integration/failure-modes.test.ts`)**
  - [ ] Implement one integration test per scenario in SPEC §10 (F1 through F16):
    - F1: Over-subscription race condition under high concurrency.
    - F2: Worker / process crash mid-transaction leaves payment pending and inventory uncommitted.
    - F3: Webhook deduplication (identical payment ID received twice yields exactly 1 ticket issuance and 1 email).
    - F4: Webhook arrives before client `/payments/verify` call.
    - F7: Double QR scan at door check-in rejected with `TICKET_ALREADY_USED`.
    - F9: Stale version write on organizer approval returns `VERSION_CONFLICT`.
    - F10: Suspended organizer events remain visible with `admin_flagged = true`.
    - F12: Event cancellation automatically initiates bulk refund queue.

- [ ] **8.3 k6 Ticket-Drop Concurrency Load Test (`load-tests/ticket-drop.js`)**
  - [ ] Configure k6 script:
    - 10,000 virtual users (VUs).
    - 100 available tickets in a high-demand drop.
    - Target: High concurrency against `POST /events/:id/reserve` followed by simulated payment confirmation.
  - [ ] Acceptance Criteria:
    - Exactly 100 tickets confirmed.
    - Zero overselling (`available_tickets >= 0` invariant strictly preserved).
    - p95 latency under 2.0 seconds.

- [ ] **8.4 MVP Tagging**
  - [ ] Verify `bun test` is green across all unit and integration suites.
  - [ ] Verify `bun run typecheck` produces 0 errors.
  - [ ] Create git release tag: `git tag v1.0.0-mvp`.

---

## Epic 9: Scalability Roadmap (Architecture §10)

Future architectural enhancements for scaling beyond initial MVP launch:

- [ ] **9.1 Scale to 10K–100K Monthly Active Users**
  - [ ] Introduce Redis caching layer for `GET /events` and `GET /events/:id`.
  - [ ] Set up PostgreSQL read replicas for browsing traffic.
- [ ] **9.2 Scale to 100K–1M Monthly Active Users**
  - [ ] Configure PgBouncer connection pooling in transaction mode.
  - [ ] Deploy global CDN caching for all media and static assets.
- [ ] **9.3 Scale to 1M+ Monthly Active Users**
  - [ ] Integrate dedicated search cluster (Meilisearch or Algolia) to offload full-text PostgreSQL search vector queries.
  - [ ] Implement regional tenant sharding and multi-region read replicas.
