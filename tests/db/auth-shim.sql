-- Supabase-compatible shim for LOCAL testing only.
-- On Supabase, the `auth` schema and auth.uid() are provided by the platform.
-- This file is NOT a migration; it lets the RLS policies in 0003_rls.sql
-- compile and lets tests impersonate a user via a session GUC.
create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
