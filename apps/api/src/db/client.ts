import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '@event-ticketing/config';

const env = getEnv();

/**
 * Service-role Supabase client. Bypasses RLS — use ONLY for operations the
 * API has already authorized, and never expose this key to the web app (§4.2).
 *
 * RLS remains the primary authorization layer (R4); this client is how the
 * trusted server writes, not a licence to skip permission checks.
 */
export const supabase: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

/**
 * A client scoped to an end user's JWT, so RLS policies apply as that user.
 * Used to prove authorization at the database layer (R4).
 */
export function supabaseAsUser(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
