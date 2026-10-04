# Scalability Roadmap (Phase 6)

LockMyTicket is designed to scale from 100 users to 10M+ users. The core architecture uses an atomic PG function (`reserve_tickets`) that scales well vertically, but horizontal scaling requires additional infrastructure.

## 1. Caching Layer (Redis)
- **Current State:** Postgres serves all reads for the public catalog (event listings, details, available ticket types).
- **Phase 6 State:** Introduce Redis for caching the `events` table (read-only views) and available capacity snapshots. 
- **Invalidation:** Update cache via Supabase Webhooks or BullMQ workers on booking/refund events.

## 2. Postgres Read Replicas (PgBouncer)
- **Current State:** Single primary database connection.
- **Phase 6 State:** Deploy PgBouncer to manage DB connections from horizontally scaled Bun API containers. Introduce a read-replica for all `GET /events` endpoints to offload read pressure from the primary writer node (which handles the critical `reserve_tickets` path).

## 3. Edge CDN for Media (Cloudinary & Cloudflare)
- **Current State:** Cloudinary handles media delivery. Next.js server serves the client.
- **Phase 6 State:** Cache all API `GET` responses that are fully public (e.g., event catalog) at the edge via Cloudflare or Vercel Edge Network. Cache headers with `s-maxage` and `stale-while-revalidate`.

## 4. Full-text Search (Meilisearch)
- **Current State:** Basic `ilike` or similar filtering.
- **Phase 6 State:** Sync `events` table to Meilisearch using Supabase DB webhooks. This provides sub-50ms typo-tolerant search across events, artists, and cities.

## 5. Async Checkout Processing
- **Current State:** Webhook verification `POST /payments/webhook` happens synchronously and verifies against PG.
- **Phase 6 State:** Webhooks drop events into a Kafka or RabbitMQ topic. Payment workers independently pull these events and call `confirmPayment()` to reduce DB connection spikes during highly concurrent flash sales.

## 6. Real-time Inventory Broadcast (WebSocket)
- **Current State:** Client polls or relies on HTTP errors to know when sold out.
- **Phase 6 State:** Use Supabase Realtime to broadcast inventory changes (or sold out status) to connected clients in the waiting room.
