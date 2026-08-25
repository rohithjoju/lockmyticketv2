import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The browser Supabase client, anon key only.
 *
 * The web app does not read business data through it — every read goes to the
 * API, where RLS runs under the caller's identity and the envelope is applied.
 * This client exists for the things Supabase does that the API does not proxy:
 * realtime subscriptions and Storage URLs.
 *
 * SUPABASE_SERVICE_ROLE_KEY must never appear in this file or any file the
 * bundler can reach (§4.2). It has no NEXT_PUBLIC_ prefix, so Next would
 * refuse to inline it, but the rule is stated here because that refusal is a
 * backstop, not the reason.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Supabase browser client is unconfigured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  client ??= createClient(url, anonKey, { auth: { persistSession: false } });
  return client;
}
