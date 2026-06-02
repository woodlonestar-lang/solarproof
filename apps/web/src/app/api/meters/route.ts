import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth, isAuthError } from '@/lib/auth'

const RegisterSchema = z.object({
  name: z.string().min(1).max(128),
  cooperative_id: z.string().uuid(),
  serial_number: z.string().min(1).max(64),
  pubkey_hex: z.string().length(64),
})

/** Generate a unique meter API key: "mk_" + 32 random bytes as hex. */
function generateApiKey(): string {
  return 'mk_' + randomBytes(32).toString('hex')
}

/** GET /api/meters — list all meters (requires operator JWT) */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  const db = createServiceClient()
  const { data, error } = await db
    .from('meters')
    .select('id, serial_number, pubkey_hex, active, created_at, cooperative_id')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** POST /api/meters — register a new meter (requires operator JWT) */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  const body = await req.json().catch(() => null)
  const parsed = RegisterSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const db = createServiceClient()

  // Check for duplicate public key
  const { data: existing } = await db
    .from('meters')
    .select('id')
    .eq('pubkey_hex', parsed.data.pubkey_hex)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'A meter with this public key already exists' }, { status: 409 })
  }

  const { data, error } = await db
    .from('meters')
    .insert({ ...parsed.data, active: true, api_key: generateApiKey() })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Return full row including api_key — only shown once at registration
  return NextResponse.json(data, { status: 201 })
}
