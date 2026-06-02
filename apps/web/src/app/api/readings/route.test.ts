/**
 * Tests for POST /api/readings
 *
 * Acceptance criteria:
 *  - Signature verified against meter's registered public key
 *  - 401 returned for invalid signatures
 *  - 400 returned for malformed payloads
 *  - Verified readings proceed to anchoring
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPublicKey, sign } from '@noble/ed25519'
import { computeReadingHash } from '@/lib/crypto'
import { kwhToStroops } from '@solarproof/stellar'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/stellar', () => ({
  anchorReading: vi.fn().mockResolvedValue('anchor_tx_abc'),
  mintCertificates: vi.fn().mockResolvedValue('mint_tx_abc'),
}))
vi.mock('@/lib/cache', () => ({
  invalidateCert: vi.fn().mockResolvedValue(undefined),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfter: 0 }),
}))
import { createServiceClient } from '@/lib/supabase'
import { POST } from '@/app/api/readings/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a fresh Ed25519 keypair and return hex strings. */
async function makeKeypair() {
  const privKey = crypto.getRandomValues(new Uint8Array(32))
  const pubKey = await getPublicKey(privKey)
  return {
    privKeyHex: Buffer.from(privKey).toString('hex'),
    pubKeyHex: Buffer.from(pubKey).toString('hex'),
    privKey,
  }
}

const METER_ID = '123e4567-e89b-12d3-a456-426614174000'
const KWH = 12.5
const TIMESTAMP = 1_700_000_000

/** Build a valid signed reading body using the given private key. */
async function makeBody(privKey: Uint8Array, overrides: Record<string, unknown> = {}) {
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

/** Build a NextRequest-like object from a plain body. */
function makeRequest(body: unknown, apiKey = 'mk_test_api_key') {
  return {
    json: () => Promise.resolve(body),
    headers: { get: (key: string) => key === 'x-api-key' ? apiKey : null },
  } as unknown as Parameters<typeof POST>[0]
}

/** Build a Supabase mock that returns the given meter row. */
function mockDb(meter: unknown) {
  const single = vi.fn().mockResolvedValue({ data: meter, error: null })
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single }) }) })
  const insertSingle = vi.fn().mockResolvedValue({
    data: { id: 'reading-id-1', ...({} as object) },
    error: null,
  })
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: insertSingle }) })
  const certInsert = vi.fn().mockResolvedValue({ error: null })

  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'meters') return { select }
      if (table === 'readings') return { insert, update }
      if (table === 'certificates') return { insert: certInsert }
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
        return {
          select: vi.fn().mockReturnValue({ eq: eq1 }),
        }
      }
      return {}
    }),
  } as ReturnType<typeof createServiceClient>)

  return { select, insert, update }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/readings', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── 400 for malformed payloads ─────────────────────────────────────────────

  it('returns 400 when body is not JSON', async () => {
    const req = { json: () => Promise.reject(new Error('bad json')), headers: { get: (_: string) => null } } as unknown as Parameters<typeof POST>[0]
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when meter_id is missing', async () => {
    const res = await POST(makeRequest({ kwh: 1, timestamp: Math.floor(Date.now() / 1000), signature_hex: 'a'.repeat(128) }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when kwh is negative', async () => {
    const res = await POST(makeRequest({ meter_id: METER_ID, kwh: -1, timestamp: Math.floor(Date.now() / 1000), signature_hex: 'a'.repeat(128) }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when signature_hex is wrong length', async () => {
    const res = await POST(makeRequest({ meter_id: METER_ID, kwh: KWH, timestamp: Math.floor(Date.now() / 1000), signature_hex: 'deadbeef' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when timestamp is missing', async () => {
    const res = await POST(makeRequest({ meter_id: METER_ID, kwh: KWH, signature_hex: 'a'.repeat(128) }))
    expect(res.status).toBe(400)
  })

  // ── 404 for unknown meter ──────────────────────────────────────────────────

  it('returns 404 when meter is not found', async () => {
    mockDb(null)
    const { privKey } = await makeKeypair()
    const res = await POST(makeRequest(await makeBody(privKey)))
    expect(res.status).toBe(404)
  })

  // ── 401 for invalid signature ──────────────────────────────────────────────

  it('returns 401 when signature is signed by a different key', async () => {
    const { pubKeyHex } = await makeKeypair()
    const { privKey: wrongPrivKey } = await makeKeypair()
    mockDb({ id: METER_ID, pubkey_hex: pubKeyHex, cooperative_id: 'coop-1', api_key: 'mk_test_api_key', cooperatives: { admin_address: 'GADMIN' } })
    const body = await makeBody(wrongPrivKey) // signed with wrong key
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toMatch(/invalid meter signature/i)
  })

  it('returns 401 when signature_hex is all zeros (invalid)', async () => {
    const { pubKeyHex } = await makeKeypair()
    mockDb({ id: METER_ID, pubkey_hex: pubKeyHex, cooperative_id: 'coop-1', api_key: 'mk_test_api_key', cooperatives: { admin_address: 'GADMIN' } })
    const body = { meter_id: METER_ID, kwh: KWH, timestamp: Math.floor(Date.now() / 1000), signature_hex: '0'.repeat(128), nonce: 'test_nonce_123' }
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(401)
  })

  // ── Valid signature proceeds to anchoring ──────────────────────────────────

  it('returns 201 and anchors when signature is valid', async () => {
    const { privKey, pubKeyHex } = await makeKeypair()
    mockDb({ id: METER_ID, pubkey_hex: pubKeyHex, cooperative_id: 'coop-1', api_key: 'mk_test_api_key', cooperatives: { admin_address: 'GADMIN' } })
    const body = await makeBody(privKey)
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.anchor_tx_hash).toBe('anchor_tx_abc')
    expect(json.mint_tx_hash).toBe('mint_tx_abc')
    expect(json.reading_id).toBeDefined()
  })

  it('calls anchorReading with the correct hash for a valid reading', async () => {
    const { privKey, pubKeyHex } = await makeKeypair()
    mockDb({ id: METER_ID, pubkey_hex: pubKeyHex, cooperative_id: 'coop-1', api_key: 'mk_test_api_key', cooperatives: { admin_address: 'GADMIN' } })
    const body = await makeBody(privKey)

    const { anchorReading } = await import('@/lib/stellar')
    await POST(makeRequest(body))

    expect(anchorReading).toHaveBeenCalledOnce()
    const callArg = vi.mocked(anchorReading).mock.calls[0][0]
    const expectedHash = computeReadingHash(METER_ID, kwhToStroops(KWH), BigInt(body.timestamp))
    expect(Buffer.from(callArg.readingHash).toString('hex')).toBe(expectedHash.toString('hex'))
  })

  // ── API key validation ─────────────────────────────────────────────────────

  it('returns 401 when x-api-key header is missing', async () => {
    const { privKey, pubKeyHex } = await makeKeypair()
    mockDb({ id: METER_ID, pubkey_hex: pubKeyHex, cooperative_id: 'coop-1', api_key: 'mk_test_api_key', cooperatives: { admin_address: 'GADMIN' } })
    const body = await makeBody(privKey)
    const res = await POST(makeRequest(body, null as unknown as string))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toMatch(/api key/i)
  })

  it('returns 401 when x-api-key is wrong', async () => {
    const { privKey, pubKeyHex } = await makeKeypair()
    mockDb({ id: METER_ID, pubkey_hex: pubKeyHex, cooperative_id: 'coop-1', api_key: 'mk_test_api_key', cooperatives: { admin_address: 'GADMIN' } })
    const body = await makeBody(privKey)
    const res = await POST(makeRequest(body, 'mk_wrong_key'))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toMatch(/api key/i)
  })
})
