import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthError } from '@/lib/auth'
import { rotateApiKey } from '@/lib/meter-api-keys'

/** POST /api/meters/[id]/rotate-key — rotate API key, invalidates all previous keys */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  const { id } = await params
  const newKey = await rotateApiKey(id).catch((err: Error) =>
    NextResponse.json({ error: err.message }, { status: 500 })
  )

  if (newKey instanceof NextResponse) return newKey
  return NextResponse.json({ api_key: newKey }, { status: 200 })
}
