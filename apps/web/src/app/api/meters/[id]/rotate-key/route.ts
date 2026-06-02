import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth, isAuthError } from '@/lib/auth'

/**
 * POST /api/meters/[id]/rotate-key
 *
 * Generates a new API key for the meter without changing the Ed25519 keypair.
 * The old key is invalidated immediately.
 * Requires operator JWT.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  const { id } = await params
  const newKey = 'mk_' + randomBytes(32).toString('hex')

  const db = createServiceClient()
  const { data, error } = await db
    .from('meters')
    .update({ api_key: newKey })
    .eq('id', id)
    .select('id, api_key')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Meter not found' }, { status: 404 })

  return NextResponse.json({ id: data.id, api_key: data.api_key })
}
