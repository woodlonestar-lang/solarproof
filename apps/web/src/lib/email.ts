import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export type EmailEvent = 'minted' | 'retired' | 'mint_failed'

interface EmailPayload {
  cooperative_id: string
  event: EmailEvent
  data: Record<string, unknown>
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://solarproof.vercel.app'

function subject(event: EmailEvent): string {
  return {
    minted: '✅ SolarProof — Certificate minted',
    retired: '🏁 SolarProof — Certificate retired',
    mint_failed: '⚠️ SolarProof — Certificate mint failed',
  }[event]
}

function html(event: EmailEvent, data: Record<string, unknown>, unsubToken: string): string {
  const unsubUrl = `${APP_URL}/api/notifications/unsubscribe?token=${unsubToken}`

  const body = {
    minted: `
      <p>A new renewable energy certificate has been minted.</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:4px 8px;font-weight:bold">Reading ID</td><td style="padding:4px 8px">${data.reading_id ?? '—'}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold">kWh</td><td style="padding:4px 8px">${data.kwh ?? '—'}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold">Mint TX</td><td style="padding:4px 8px">${data.mint_tx_hash ?? '—'}</td></tr>
      </table>`,
    retired: `
      <p>A certificate has been retired.</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:4px 8px;font-weight:bold">Certificate ID</td><td style="padding:4px 8px">${data.certificate_id ?? '—'}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold">Retired by</td><td style="padding:4px 8px">${data.retired_by ?? '—'}</td></tr>
      </table>`,
    mint_failed: `
      <p>A certificate mint has failed.</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:4px 8px;font-weight:bold">Reading ID</td><td style="padding:4px 8px">${data.reading_id ?? '—'}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold">Error</td><td style="padding:4px 8px">${data.error ?? '—'}</td></tr>
      </table>`,
  }[event]

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject(event)}</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <div style="border-left:4px solid #f59e0b;padding-left:16px;margin-bottom:24px">
    <h1 style="margin:0;font-size:20px;color:#f59e0b">SolarProof</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#6b7280">Renewable Energy Certification</p>
  </div>
  <h2 style="font-size:16px">${subject(event)}</h2>
  ${body}
  <hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb">
  <p style="font-size:11px;color:#9ca3af">
    You are receiving this because you have notifications enabled for your cooperative.<br>
    <a href="${unsubUrl}" style="color:#6b7280">Unsubscribe</a>
  </p>
</body>
</html>`
}

/**
 * Send an email notification to the cooperative operator if they have
 * the relevant notification type enabled. Never throws — failures are logged.
 */
export async function sendNotification(payload: EmailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'SolarProof <notifications@solarproof.app>'

  if (!apiKey) return // email not configured — silently skip

  const db = createServiceClient()
  const { data: prefs } = await db
    .from('operator_notification_prefs')
    .select('email, notify_minted, notify_retired, notify_mint_failed, unsubscribe_token')
    .eq('cooperative_id', payload.cooperative_id)
    .single()

  if (!prefs) return

  const enabledMap: Record<EmailEvent, boolean> = {
    minted: prefs.notify_minted,
    retired: prefs.notify_retired,
    mint_failed: prefs.notify_mint_failed,
  }
  if (!enabledMap[payload.event]) return

  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from,
      to: prefs.email,
      subject: subject(payload.event),
      html: html(payload.event, payload.data, prefs.unsubscribe_token),
    })
    if (error) {
      logger.warn('email.send_failed', { cooperative_id: payload.cooperative_id, event: payload.event, error: error.message })
    }
  } catch (err) {
    logger.warn('email.send_error', { cooperative_id: payload.cooperative_id, event: payload.event, error: String(err) })
  }
}
