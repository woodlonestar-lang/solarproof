import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthError } from '@/lib/auth'
import { revokeApiKey } from '@/lib/meter-api-keys'
import { createServiceClient } from '@/lib/supabase'

/** GET /api/meters/[id]/keys — list API keys (id, hint, active, created_at) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  const { id } = await params
  const db = createServiceClient()
  const { data, error } = await db
    .from('meter_api_keys')
    .select('id, hint, active, created_at, rotated_at, revoked_at')
    .eq('meter_id', id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** DELETE /api/meters/[id]/keys/[keyId] is handled by the dedicated route; this
 *  endpoint accepts DELETE with `{ key_id }` body for convenience. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  await params // consume
  const body = await req.json().catch(() => null)
  const keyId: string | undefined = body?.key_id
  if (!keyId) return NextResponse.json({ error: 'key_id required' }, { status: 400 })

  await revokeApiKey(keyId).catch((err: Error) => {
    throw err
  })
  return NextResponse.json({ revoked: true })
}
