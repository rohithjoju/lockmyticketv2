# Automation Testing Suite (Playwright E2E)

This test suite covers end-to-end user journeys, UI controls, security boundaries, and API integrations matching [TODO.md](../../TODO.md) and [SPEC.md](../../docs/SPEC.md).

## Test Suites

1. **`auth.spec.ts`**: Login, registration, password reset, session validation, cookie security.
2. **`attendee.spec.ts`**: Ticket holds, reservation limits, expiry, payments, QR security, refund requests.
3. **`events.spec.ts`**: Event discovery, full-text search, city filtering, event detail, ticket availability indicators, cancelled/sold out badges.
4. **`organizer.spec.ts`**: Onboarding KYC validation, event creation, capacity adjustments, door QR verification, attendee PII protection.
5. **`admin.spec.ts`**: Admin navigation, user governance, suspension, organizer verification queue, optimistic locking.
6. **`security-edgecases.spec.ts`**: Rate limiting/brute force lockout, role escalation guards, immediate session revocation, envelope consistency.
7. **`epic1-epic2-booking-wallet.spec.ts`** *(New)*:
   - **Epic 1**: Interactive `BookingCta` quantity selector, real-time pricing calculation, reservation hold timer triggers, pay button transition.
   - **Epic 2**: `TicketQRModal` with UTC pulse clock, admission state badges, `TicketRefundModal` with policy calculation and double-confirmation flow.
8. **`epic3-epic4-organizer-ops.spec.ts`** *(New)*:
   - **Epic 3**: `OrganizerUpgradePage` KYC PDF upload and client-side validations; `OrganizerStatusPage` review tracking.
   - **Epic 4**: `OrganizerEventsPage` list with quick metrics; event create & edit with ticket tiers; analytics dashboard; attendee roster with strict PII protection; door camera scanner UI.
9. **`epic5-admin-governance.spec.ts`** *(New)*:
   - **Epic 5**: Admin dashboard overview with KPI cards and route navigation; user governance with search and self-disable safety guard; organizer verification queue with KYC inspection and rejection reasoning; events moderation panel; audit logs explorer with collapsible JSON diffs.

## How to Run

Ensure both frontend and backend development servers are running (`http://localhost:3000` and `http://localhost:3001`):

```bash
cd tests/automation

# List all discovered test cases
bun x playwright test --list

# Run all automation tests
bun x playwright test

# Run a specific test suite
bun x playwright test epic1-epic2-booking-wallet.spec.ts
bun x playwright test epic3-epic4-organizer-ops.spec.ts
bun x playwright test epic5-admin-governance.spec.ts
```
