import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

/**
 * GET /api/notifications/unsubscribe?token=<unsubscribe_token>
 *
 * Disables all email notifications for the cooperative associated with
 * the token. Tokens are single-use and cooperative-scoped.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('operator_notification_prefs')
    .update({ notify_minted: false, notify_retired: false, notify_mint_failed: false })
    .eq('unsubscribe_token', token)
    .select('cooperative_id')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 })
  }

  return NextResponse.json({ unsubscribed: true })
}
