# Event Ticketing Platform

This repository houses a multi-tenant event ticketing platform featuring role-based access control (attendee, organizer, admin), high-performance ticket reservations, and robust authentication.

## Stack Overview
- **Frontend**: Next.js 15 (App Router)
- **Backend API**: Elysia.js (Bun runtime)
- **Database**: Supabase (PostgreSQL)
- **Tooling**: Playwright for E2E Automation, TypeScript

## Key Functionalities Implemented
- **Authentication**: Fully functional JWT-based authentication using HTTP-only secure cookies with robust error handling (including detailed validation and `INVALID_CREDENTIALS` states), CSP-compliant hydration logic, and account enumeration protection.
- **Shared Types**: A `packages/types` workspace guarantees type safety across the `apps/web` client and `apps/api` server.
- **Environment Configuration**: A strictly typed environment schema (`packages/config`) guarantees safe booting.
- **E2E Testing**: Comprehensive Playwright automation suite located in `tests/automation/`, verifying security constraints and client-side behavior.

## Documentation
- Detailed Technical Spec: [`docs/SPEC.md`](./docs/SPEC.md)
- Architecture Overview: [`docs/architecture.md`](./docs/architecture.md)
- Developer Commands / Claude Instructions: [`CLAUDE.md`](./CLAUDE.md)

## Getting Started

1. Ensure you have `bun` installed.
2. Run `bun install` at the root.
3. Configure your local `.env` variables as specified in the packages/config schema.

### Useful Commands
```bash
bun run dev        # Run API + Web Dev Server
bun run test       # Run Unit tests
bun run test:e2e   # Run Playwright E2E Auth tests
bun run typecheck  # Validate typescript types across monorepo
```
