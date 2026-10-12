# Production Hosting Guide & Pre-Deployment Checklist

This document details everything required to configure, verify, and host the **LockMyTicket** event ticketing platform.

```
                          ┌──────────────────────────┐
                          │   Frontend (Next.js 15)  │  (Vercel / Cloudflare)
                          │         apps/web         │
                          └─────────────┬────────────┘
                                        │ HTTPS / Cookies
                          ┌─────────────▼────────────┐
                          │  Backend API & Workers   │  (Railway / Render / Fly / VPS)
                          │   Elysia.js (Bun 1.3+)   │
                          └──────┬────────────┬──────┘
             Direct SQL / RLS    │            │ BullMQ Queues
        ┌────────────────────────▼───┐    ┌───▼──────────────────┐
        │       Supabase Cloud       │    │     Redis Cloud      │
        │  PostgreSQL + DB Functions │    │  (Upstash / Railway) │
        └────────────────────────────┘    └──────────────────────┘
```

---

## Part 1: Pre-Hosting Checklist (What You Must Do Before Hosting)

### 1. Code Verification & Type Safety
- **Typecheck Verified:** `bun run typecheck` passes cleanly across all 4 packages (`@event-ticketing/api`, `@event-ticketing/web`, `@event-ticketing/config`, `@event-ticketing/types`).
- **Environment Schema:** `packages/config/src/env.ts` has been updated with `RESEND_API_KEY`.

---

### 2. External Services & Credentials Checklist
Obtain credentials from each service provider before deploying:

| Service | Purpose | Required Variables |
| :--- | :--- | :--- |
| **Supabase Cloud** | Database, Auth, RLS, Transaction locking | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` |
| **Upstash / Railway Redis** | BullMQ workers & rate limiting | `REDIS_URL` (e.g. `rediss://...`) |
| **Razorpay** | Payment processing & webhooks | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| **Cloudinary** | Event banners & KYC PDF storage | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| **Mapbox** | Interactive venue maps | `NEXT_PUBLIC_MAPBOX_TOKEN` |
| **Resend** | Transactional emails | `RESEND_API_KEY` |
| **Google Cloud Console** *(Optional)* | Google OAuth login | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

> [!IMPORTANT]
> **Why `DATABASE_URL` is required alongside `SUPABASE_URL`:**
> Rules R1 & R2 mandate atomic multi-statement database transactions with row-level locking (`SELECT ... FOR UPDATE` via `db/transaction.ts`) during checkout to guarantee zero ticket overselling. The HTTP Supabase client does not support multi-statement transactions, so direct Postgres access via `DATABASE_URL` is required for the backend API.

---

### 3. Database Migrations Setup
Apply schema migrations against your Supabase Cloud PostgreSQL database in the following sequence:

1. `supabase/migrations/0001_schema.sql` — Core tables, enums, triggers
2. `supabase/migrations/0002_functions.sql` — Atomic reservation & release functions (`reserve_tickets`, `expire_reservations`)
3. `supabase/migrations/0003_rls.sql` — Row-Level Security policies
4. `supabase/migrations/0005_cancel_ticket.sql` — Cancellation and refund helpers
5. `supabase/migrations/0006_rls_admin.sql` — Admin audit and governance policies

> [!WARNING]
> **Do NOT run `0004_seed.sql` on a production database!**
> `0004_seed.sql` is meant exclusively for local testing and populates dummy test accounts and events.

---

### 4. Cryptographic Secrets Generation
Per rule **R8**, authentication and QR ticket validation tokens must use completely distinct secrets of at least 32 characters:

```bash
# Generate two distinct 64-character hex secrets:
openssl rand -hex 32   # Set to JWT_SECRET
openssl rand -hex 32   # Set to QR_JWT_SECRET
```

---

### 5. Domain & Cookie Architecture
The backend issues HTTP-only authentication cookies configured with:
```ts
httpOnly: true, secure: true, sameSite: 'lax', path: '/'
```
If the frontend and backend are hosted on separate root domains (e.g., `ticket-app.vercel.app` vs `ticket-api.railway.app`), browsers will block `SameSite=Lax` cookies on cross-origin AJAX/fetch requests.

**Recommended configurations:**
- **Custom Subdomains (Best):** Frontend on `https://app.yourdomain.com`, API on `https://api.yourdomain.com`.
- **Next.js Reverse Proxy:** Add rewrites in `apps/web/next.config.ts` mapping `/api/v1/:path*` directly to the backend URL, keeping requests strictly same-origin.

---

## Part 2: Step-by-Step Hosting Guide

Because Elysia.js runs on the **Bun runtime** and executes background workers (`startEmailWorker`, `startMediaWorker`, `startReconcileWorker`), the backend must run on a persistent container or VM platform (not serverless functions).

---

### Option A: Modern Managed Cloud (Recommended)
- **Frontend:** Vercel
- **Backend:** Railway / Render / Fly.io

#### Step 1: Deploy Backend (`apps/api`)
1. Create a `Dockerfile` at the repository root:
   ```dockerfile
   FROM oven/bun:1.2-alpine AS base
   WORKDIR /app

   COPY package.json bun.lock turbo.json ./
   COPY packages/ ./packages/
   COPY apps/api/ ./apps/api/

   RUN bun install --frozen-lockfile

   EXPOSE 3001

   CMD ["bun", "run", "--cwd", "apps/api", "src/index.ts"]
   ```
2. Connect your repo to Railway / Render / Fly.io and select Dockerfile deployment.
3. Set the target port to `3001` (or map `$PORT`).
4. Set backend environment variables:
   ```ini
   NODE_ENV=production
   API_PORT=3001
   WEB_URL=https://your-frontend-domain.com
   API_URL=https://your-api-domain.com

   SUPABASE_MODE=cloud
   SUPABASE_URL=https://<your-project-id>.supabase.co
   SUPABASE_ANON_KEY=<your-anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
   DATABASE_URL=postgresql://postgres:<password>@db.<your-project-id>.supabase.co:5432/postgres

   JWT_SECRET=<secret-1-at-least-32-chars>
   QR_JWT_SECRET=<secret-2-at-least-32-chars>
   ACCESS_TOKEN_TTL=15m
   REFRESH_TOKEN_TTL=7d
   QR_TOKEN_TTL=24h

   REDIS_URL=rediss://default:<password>@<host>:<port>

   RAZORPAY_KEY_ID=rzp_live_...
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...

   CLOUDINARY_CLOUD_NAME=...
   CLOUDINARY_API_KEY=...
   CLOUDINARY_API_SECRET=...

   RESEND_API_KEY=re_...
   NEXT_PUBLIC_MAPBOX_TOKEN=pk....
   ```

#### Step 2: Deploy Frontend (`apps/web`) to Vercel
1. In Vercel, import your Git repository.
2. Select **Next.js** framework preset.
3. Set **Root Directory** to `apps/web`.
4. Configure Build Command: `cd ../.. && bun run build` (or default if Bun runtime is detected).
5. Set frontend environment variables:
   ```ini
   API_URL=https://your-api-domain.com
   NEXT_PUBLIC_API_URL=https://your-api-domain.com
   SUPABASE_URL=https://<your-project-id>.supabase.co
   NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
   SUPABASE_ANON_KEY=<your-anon-key>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
   RAZORPAY_KEY_ID=rzp_live_...
   NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_...
   NEXT_PUBLIC_MAPBOX_TOKEN=pk....
   ```
6. Deploy the project.

---

### Step 3: Configure Razorpay Webhooks
1. Open your **Razorpay Dashboard** -> **Settings** -> **Webhooks**.
2. Click **Add New Webhook**.
3. **Webhook URL:** `https://your-api-domain.com/api/v1/payments/webhook`
4. **Secret:** Set to the same value as `RAZORPAY_WEBHOOK_SECRET`.
5. **Events to enable:**
   - `payment.captured`
   - `payment.failed`
   - `refund.processed`
6. Save webhook configuration.

---

## Part 3: Post-Deployment Verification Checklist

- [ ] **Health Endpoint:** Verify `GET https://your-api-domain.com/api/v1/health` returns status `ok`.
- [ ] **API Documentation:** Verify `GET https://your-api-domain.com/docs` loads Swagger API documentation.
- [ ] **Authentication & Cookies:** Register a new user and log in to verify HTTP-only refresh cookies.
- [ ] **Asset Uploads:** Test creating an event with a poster upload (verifies Cloudinary integration).
- [ ] **Inventory Reservation:** Reserve tickets on an event page to verify the 10-minute hold countdown timer.
- [ ] **Payment Flow:** Complete a test booking via Razorpay checkout and confirm tickets show in Attendee Dashboard.
- [ ] **QR Admission Scanner:** Access `/organizer/events/[id]/scan` to test ticket QR code validation.
