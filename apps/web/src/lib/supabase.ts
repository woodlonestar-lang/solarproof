import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { env } from '@/env'

export const supabase = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

/**
 * Anon client — uses the public anon key; RLS is enforced.
 * Use for public read-only endpoints (e.g. /api/verify) that require no auth.
 */
export function createAnonClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  )
}

/**
 * Service-role client — bypasses RLS. Use ONLY in trusted server contexts:
 *   - Writing readings, certificates, jobs (device-submitted, already verified)
 *   - Audit log writes (must never be gated by operator RLS)
 *   - Background job processing (no user JWT available)
 *   - Webhook fan-out (cross-cooperative queries)
 *   - Health checks (needs cross-tenant visibility)
 * See docs/adr/007-supabase-service-role-usage.md for the full justification.
 */
export function createServiceClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
}
