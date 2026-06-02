/**
 * Regression tests for known bug fixes.
 *
 * Each test is named with the issue number it guards against.
 * See CONTRIBUTING.md § Regression Tests for the process.
 *
 * Issues covered:
 *  #29 — Input validation and sanitization on all API routes
 *  #49 — Stellar account existence check before minting
 *  #73 — Reading deduplication in audit_registry (API layer)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPublicKey, sign } from '@noble/ed25519'
import { computeReadingHash } from '@/lib/crypto'
import { kwhToStroops } from '@solarproof/stellar'

// ── Shared mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/stellar', () => ({
  anchorReading: vi.fn().mockResolvedValue('anchor_tx_abc'),
  mintCertificates: vi.fn().mockResolvedValue('mint_tx_abc'),
}))
vi.mock('@/lib/cache', () => ({
  invalidateCert: vi.fn().mockResolvedValue(undefined),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
  isAuthError: vi.fn().mockReturnValue(false),
}))
vi.mock('@/lib/webhooks', () => ({
  fireWebhook: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/tracer-sim', () => ({
  diagnoseMintFailure: vi.fn().mockResolvedValue(null),
}))

import { createServiceClient } from '@/lib/supabase'
import { POST as postReading } from '@/app/api/readings/route'
import { POST as postMeter } from '@/app/api/meters/route'
import { mintCertificates } from '@/lib/stellar'

// ── Helpers ───────────────────────────────────────────────────────────────────

const METER_ID = '123e4567-e89b-12d3-a456-426614174000'
const KWH = 5.0
const TIMESTAMP = 1_700_000_000

async function makeKeypair() {
  const privKey = crypto.getRandomValues(new Uint8Array(32))
  const pubKey = await getPublicKey(privKey)
  return {
    privKey,
    pubKeyHex: Buffer.from(pubKey).toString('hex'),
  }
}

async function makeReadingBody(privKey: Uint8Array, overrides: Record<string, unknown> = {}) {
  const kwhStroops = kwhToStroops(KWH)
  const currentTimestamp = overrides.timestamp as number ?? Math.floor(Date.now() / 1000)
  const hash = computeReadingHash(METER_ID, kwhStroops, BigInt(currentTimestamp))
  const sig = await sign(hash, privKey)
  return {
    meter_id: METER_ID,
    kwh: KWH,
    timestamp: currentTimestamp,
    signature_hex: Buffer.from(sig).toString('hex'),
    nonce: 'test_nonce_123',
    ...overrides,
  }
}

function makeReadingRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
    headers: { get: (key: string) => key === 'x-api-key' ? 'mk_test_api_key' : null },
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as Parameters<typeof postReading>[0]
}

function makeMeterRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
    headers: { get: (_: string) => null },
  } as unknown as Parameters<typeof postMeter>[0]
}

function mockReadingDb(meter: unknown) {
  const single = vi.fn().mockResolvedValue({ data: meter, error: null })
  const readingSingle = vi.fn().mockResolvedValue({
    data: { id: 'reading-id-1' },
    error: null,
  })
  const updateEq = vi.fn().mockResolvedValue({ error: null })

  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'meters') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ single }),
            }),
          }),
        }
      }
      if (table === 'readings') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ single: readingSingle }),
          }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }
      if (table === 'certificates') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      if (table === 'idempotency_keys') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({}),
          }),
        }
      }
      if (table === 'webhook_endpoints') {
        const contains = vi.fn().mockResolvedValue({ data: [] })
        const eq2 = vi.fn().mockReturnValue({ contains })
        const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
        return { select: vi.fn().mockReturnValue({ eq: eq1 }) }
      }
      return {}
    }),
  } as ReturnType<typeof createServiceClient>)
}

function mockMeterDb({ existing = null }: { existing?: unknown } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing })
  const insertSingle = vi.fn().mockResolvedValue({
    data: { id: 'meter-1', active: true },
    error: null,
  })
  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single: insertSingle }),
      }),
    }),
  } as ReturnType<typeof createServiceClient>)
}

beforeEach(() => vi.clearAllMocks())

// ── Issue #29 — Input validation on all API routes ────────────────────────────

describe('regression issue_29: input validation on API routes', () => {
  it('test_issue_29_readings_rejects_missing_meter_id', async () => {
    const res = await postReading(
      makeReadingRequest({ kwh: KWH, timestamp: TIMESTAMP, signature_hex: 'a'.repeat(128) })
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('test_issue_29_readings_rejects_negative_kwh', async () => {
    const res = await postReading(
      makeReadingRequest({ meter_id: METER_ID, kwh: -1, timestamp: TIMESTAMP, signature_hex: 'a'.repeat(128) })
    )
    expect(res.status).toBe(400)
  })

  it('test_issue_29_readings_rejects_zero_kwh', async () => {
    const res = await postReading(
      makeReadingRequest({ meter_id: METER_ID, kwh: 0, timestamp: TIMESTAMP, signature_hex: 'a'.repeat(128) })
    )
    expect(res.status).toBe(400)
  })

  it('test_issue_29_readings_rejects_missing_timestamp', async () => {
    const res = await postReading(
      makeReadingRequest({ meter_id: METER_ID, kwh: KWH, signature_hex: 'a'.repeat(128) })
    )
    expect(res.status).toBe(400)
  })

  it('test_issue_29_readings_rejects_short_signature', async () => {
    const res = await postReading(
      makeReadingRequest({ meter_id: METER_ID, kwh: KWH, timestamp: TIMESTAMP, signature_hex: 'deadbeef' })
    )
    expect(res.status).toBe(400)
  })

  it('test_issue_29_readings_rejects_non_uuid_meter_id', async () => {
    const res = await postReading(
      makeReadingRequest({ meter_id: 'not-a-uuid', kwh: KWH, timestamp: TIMESTAMP, signature_hex: 'a'.repeat(128) })
    )
    expect(res.status).toBe(400)
  })

  it('test_issue_29_readings_rejects_non_json_body', async () => {
    const req = {
      json: () => Promise.reject(new Error('bad json')),
      headers: { get: (_: string) => null },
    } as unknown as Parameters<typeof postReading>[0]
    const res = await postReading(req)
    expect(res.status).toBe(400)
  })

  it('test_issue_29_meters_rejects_missing_name', async () => {
    mockMeterDb()
    const res = await postMeter(
      makeMeterRequest({
        cooperative_id: '123e4567-e89b-12d3-a456-426614174000',
        serial_number: 'SN-001',
        pubkey_hex: 'a'.repeat(64),
      })
    )
    expect(res.status).toBe(400)
  })

  it('test_issue_29_meters_rejects_invalid_cooperative_id', async () => {
    mockMeterDb()
    const res = await postMeter(
      makeMeterRequest({
        name: 'Panel A',
        cooperative_id: 'not-a-uuid',
        serial_number: 'SN-001',
        pubkey_hex: 'a'.repeat(64),
      })
    )
    expect(res.status).toBe(400)
  })

  it('test_issue_29_meters_rejects_wrong_length_pubkey', async () => {
    mockMeterDb()
    const res = await postMeter(
      makeMeterRequest({
        name: 'Panel A',
        cooperative_id: '123e4567-e89b-12d3-a456-426614174000',
        serial_number: 'SN-001',
        pubkey_hex: 'tooshort',
      })
    )
    expect(res.status).toBe(400)
  })

  it('test_issue_29_validation_runs_before_db_access', async () => {
    // DB mock is NOT set up — if validation runs first, no DB call is made
    const res = await postReading(
      makeReadingRequest({ meter_id: METER_ID, kwh: -99, timestamp: TIMESTAMP, signature_hex: 'a'.repeat(128) })
    )
    expect(res.status).toBe(400)
    // createServiceClient should not have been called
    expect(createServiceClient).not.toHaveBeenCalled()
  })
})

// ── Issue #49 — Stellar account existence check before minting ────────────────

describe('regression issue_49: Stellar account existence check before minting', () => {
  it('test_issue_49_mint_succeeds_when_account_exists', async () => {
    const { privKey, pubKeyHex } = await makeKeypair()
    mockReadingDb({
      id: METER_ID,
      pubkey_hex: pubKeyHex,
      cooperative_id: 'coop-1',
      api_key: 'mk_test_api_key',
      cooperatives: { admin_address: 'GADMIN123' },
    })

    const body = await makeReadingBody(privKey)
    const res = await postReading(makeReadingRequest(body))

    expect(res.status).toBe(201)
    expect(mintCertificates).toHaveBeenCalledWith('GADMIN123', KWH)
  })

  it('test_issue_49_returns_500_when_account_does_not_exist', async () => {
    const { privKey, pubKeyHex } = await makeKeypair()
    mockReadingDb({
      id: METER_ID,
      pubkey_hex: pubKeyHex,
      cooperative_id: 'coop-1',
      api_key: 'mk_test_api_key',
      cooperatives: { admin_address: 'GNONEXISTENT' },
    })

    vi.mocked(mintCertificates).mockRejectedValueOnce(
      new Error('Recipient account GNONEXISTENT does not exist on Stellar.')
    )

    const body = await makeReadingBody(privKey)
    const res = await postReading(makeReadingRequest(body))

    // Mint failure must not silently succeed
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/does not exist/i)
    expect(json.reading_id).toBeDefined()
    expect(json.anchor_tx_hash).toBeDefined()
  })

  it('test_issue_49_returns_500_when_trustline_missing', async () => {
    const { privKey, pubKeyHex } = await makeKeypair()
    mockReadingDb({
      id: METER_ID,
      pubkey_hex: pubKeyHex,
      cooperative_id: 'coop-1',
      api_key: 'mk_test_api_key',
      cooperatives: { admin_address: 'GNOTRUSTED' },
    })

    vi.mocked(mintCertificates).mockRejectedValueOnce(
      new Error('Recipient account GNOTRUSTED has no trustline for the energy_token contract.')
    )

    const body = await makeReadingBody(privKey)
    const res = await postReading(makeReadingRequest(body))

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/trustline/i)
  })

  it('test_issue_49_missing_cooperative_address_fails_gracefully', async () => {
    const { privKey, pubKeyHex } = await makeKeypair()
    mockReadingDb({
      id: METER_ID,
      pubkey_hex: pubKeyHex,
      cooperative_id: 'coop-1',
      api_key: 'mk_test_api_key',
      cooperatives: null, // no admin address
    })

    const body = await makeReadingBody(privKey)
    const res = await postReading(makeReadingRequest(body))

    // Must not crash — should return a structured error
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })
})

// ── Issue #73 — Reading deduplication (API layer) ─────────────────────────────

describe('regression issue_73: reading deduplication at API layer', () => {
  it('test_issue_73_duplicate_anchor_returns_409', async () => {
    const { privKey, pubKeyHex } = await makeKeypair()
    mockReadingDb({
      id: METER_ID,
      pubkey_hex: pubKeyHex,
      cooperative_id: 'coop-1',
      api_key: 'mk_test_api_key',
      cooperatives: { admin_address: 'GADMIN123' },
    })

    const { anchorReading } = await import('@/lib/stellar')
    vi.mocked(anchorReading).mockRejectedValueOnce(
      new Error('AlreadyAnchored: reading already anchored')
    )

    const body = await makeReadingBody(privKey)
    const res = await postReading(makeReadingRequest(body))

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/already anchored/i)
  })

  it('test_issue_73_duplicate_error_includes_reading_id', async () => {
    const { privKey, pubKeyHex } = await makeKeypair()
    mockReadingDb({
      id: METER_ID,
      pubkey_hex: pubKeyHex,
      cooperative_id: 'coop-1',
      api_key: 'mk_test_api_key',
      cooperatives: { admin_address: 'GADMIN123' },
    })

    const { anchorReading } = await import('@/lib/stellar')
    vi.mocked(anchorReading).mockRejectedValueOnce(
      new Error('reading already anchored')
    )

    const body = await makeReadingBody(privKey)
    const res = await postReading(makeReadingRequest(body))

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.reading_id).toBeDefined()
  })

  it('test_issue_73_unique_readings_are_not_rejected', async () => {
    const { privKey, pubKeyHex } = await makeKeypair()
    mockReadingDb({
      id: METER_ID,
      pubkey_hex: pubKeyHex,
      cooperative_id: 'coop-1',
      api_key: 'mk_test_api_key',
      cooperatives: { admin_address: 'GADMIN123' },
    })

    const body = await makeReadingBody(privKey)
    const res = await postReading(makeReadingRequest(body))

    // A fresh reading must succeed
    expect(res.status).toBe(201)
  })

  it('test_issue_73_duplicate_keyword_in_error_triggers_409', async () => {
    // Verify the deduplication check matches both "AlreadyAnchored" and "duplicate"
    const { privKey, pubKeyHex } = await makeKeypair()
    mockReadingDb({
      id: METER_ID,
      pubkey_hex: pubKeyHex,
      cooperative_id: 'coop-1',
      api_key: 'mk_test_api_key',
      cooperatives: { admin_address: 'GADMIN123' },
    })

    const { anchorReading } = await import('@/lib/stellar')
    vi.mocked(anchorReading).mockRejectedValueOnce(new Error('duplicate key'))

    const body = await makeReadingBody(privKey)
    const res = await postReading(makeReadingRequest(body))

    expect(res.status).toBe(409)
  })
})
