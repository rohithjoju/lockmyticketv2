-- ============================================================
-- R4: authorization lives in the database, and the application layer is only
-- the second check. 0003_rls.sql covers the attendee and organizer paths, but
-- leaves the Phase 5 admin paths with no policy that permits them:
--
--   * users_self_update is `using (id = auth.uid())`, so an admin disabling
--     someone else matched no policy — the middleware check would have been
--     the ONLY thing standing between a non-admin and that write.
--   * organizers had no INSERT policy at all, so an upgrade application could
--     not be written by the applicant.
--
-- These policies close that gap. They are additive: nothing here widens what a
-- non-admin can already reach, and every one of them is a second lock behind
-- the middleware, never a replacement for it.
-- ============================================================

-- ---------- users: admins may change role/status, nobody else may
create policy users_admin_update on users
  for update using (is_admin()) with check (is_admin());

-- ---------- organizers: an applicant creates exactly one record, their own
create policy organizers_self_insert on organizers
  for insert with check (user_id = auth.uid());

-- Admins act on the approval queue; the `version` optimistic lock (F9) is
-- enforced by the UPDATE predicate in admin.service.ts, not by RLS.
create policy organizers_admin_read on organizers
  for select using (is_admin());

-- ---------- audit_logs: append-only, and readable by admins alone.
-- 0003 granted SELECT to admins. There is deliberately NO insert/update/delete
-- policy for any client role: entries are written by the API's service-role
-- connection, so a compromised admin session cannot forge or erase history.

-- ---------- events: an admin must be able to flag an event (F10)
-- events_owner_write in 0003 already covers `is_admin()` for ALL commands;
-- restated here only as a comment so the F10 path is traceable.
