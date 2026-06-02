import { createHash, randomBytes } from 'crypto'
import { createServiceClient } from '@/lib/supabase'

const KEY_PREFIX = 'sp_mk_'
const KEY_BYTES = 32

/** Generate a new random API key and return both the raw value and its SHA-256 hash. */
export function generateApiKey(): { raw: string; hash: string; hint: string } {
  const raw = KEY_PREFIX + randomBytes(KEY_BYTES).toString('hex')
  return { raw, hash: hashApiKey(raw), hint: raw.slice(-4) }
}

/** SHA-256 hash of a raw API key (hex output). */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Look up a meter by its raw API key.
 * Returns the meter row if the key is active, or null otherwise.
 */
export async function validateApiKey(raw: string): Promise<{ meter_id: string } | null> {
  const hash = hashApiKey(raw)
  const db = createServiceClient()

  const { data } = await db
    .from('meter_api_keys')
    .select('meter_id')
    .eq('key_hash', hash)
    .eq('active', true)
    .single()

  return data ?? null
}

/** Issue a new API key for a meter (deactivates no existing keys). */
export async function issueApiKey(meterId: string): Promise<string> {
  const { raw, hash, hint } = generateApiKey()
  const db = createServiceClient()

  const { error } = await db
    .from('meter_api_keys')
    .insert({ meter_id: meterId, key_hash: hash, hint, active: true })

  if (error) throw new Error(`Failed to issue API key: ${error.message}`)
  return raw
}

/**
 * Rotate the active API key for a meter: deactivates all current keys and
 * issues a fresh one. The new raw key is returned (shown once).
 */
export async function rotateApiKey(meterId: string): Promise<string> {
  const db = createServiceClient()

  await db
    .from('meter_api_keys')
    .update({ active: false, rotated_at: new Date().toISOString() })
    .eq('meter_id', meterId)
    .eq('active', true)

  return issueApiKey(meterId)
}

/** Revoke a specific API key by its id. */
export async function revokeApiKey(keyId: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('meter_api_keys')
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq('id', keyId)

  if (error) throw new Error(`Failed to revoke API key: ${error.message}`)
}
