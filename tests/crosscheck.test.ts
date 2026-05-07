/**
 * Cross-check the TypeScript SDK against the canonical wire-format
 * test vectors at ./vector.json (mirrored from
 * <repo>/tests/crosscheck/vector.json).
 *
 * These are the same vectors exercised by the Python and Rust SDKs.
 * Any new SDK must pass every fixture in vector.json — that's how we
 * guarantee wire-format compatibility across languages.
 *
 * Run with: `npm test`.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Verifier,
  PublicKey,
  parseLicenseKey,
  isExpiredAt,
  hasEntitlement,
  hashFingerprint,
  LicensingError,
  KEY_VERSION_V1,
  KEY_VERSION_V2,
} from '../src/index.js'

interface Fixture {
  licenseKey: string
  expected: {
    version: number
    productUuid: string
    licenseUuid: string
    issuedAt: number
    expiresAt: number
    flags: number
    isFingerprintBound: boolean
    isTrial: boolean
    entitlements: string[]
    fingerprintRaw: string | null
    fingerprintHashHex: string
  }
}

interface Vectors {
  publicKeyPem: string
  v1: Fixture
  v2: Fixture
  v2_perpetual_unbound?: Fixture
}

const vectors: Vectors = JSON.parse(
  readFileSync(join(__dirname, 'vector.json'), 'utf8'),
)

const verifier = new Verifier(PublicKey.fromPem(vectors.publicKeyPem))

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}

// ----------------------------------------------------------------------
// v1 fixture: legacy fixed-74 layout, fingerprint-bound, no expiry,
// no entitlements.
// ----------------------------------------------------------------------

describe('v1 fixture', () => {
  it('parses', () => {
    const parsed = parseLicenseKey(vectors.v1.licenseKey)
    const exp = vectors.v1.expected
    expect(parsed.payload.version).toBe(exp.version)
    expect(parsed.payload.version).toBe(KEY_VERSION_V1)
    expect(parsed.payload.productUuid).toBe(exp.productUuid)
    expect(parsed.payload.licenseUuid).toBe(exp.licenseUuid)
    expect(parsed.payload.issuedAt).toBe(exp.issuedAt)
    expect(parsed.payload.expiresAt).toBe(exp.expiresAt)
    expect(parsed.payload.flags).toBe(exp.flags)
    expect(parsed.payload.isFingerprintBound).toBe(exp.isFingerprintBound)
    expect(parsed.payload.isTrial).toBe(exp.isTrial)
    expect(parsed.payload.entitlements).toEqual(exp.entitlements)
    expect(bytesToHex(parsed.payload.fingerprintHash)).toBe(
      exp.fingerprintHashHex,
    )
  })

  it('verifies signature', () => {
    const ok = verifier.verify(vectors.v1.licenseKey)
    expect(ok.productId).toBe(vectors.v1.expected.productUuid)
    expect(ok.licenseId).toBe(vectors.v1.expected.licenseUuid)
  })

  it('detects tampering', () => {
    const key = vectors.v1.licenseKey
    const dashIdx = key.indexOf('-')
    expect(dashIdx).toBeGreaterThan(0)
    const payloadStart = dashIdx + 1
    const swapChar = key[payloadStart] !== 'B' ? 'B' : 'C'
    const tampered =
      key.substring(0, payloadStart) +
      swapChar +
      key.substring(payloadStart + 1)
    expect(() => verifier.verify(tampered)).toThrow(LicensingError)
  })
})

// ----------------------------------------------------------------------
// v2 fixture: trial, fingerprint-bound, explicit expiry, two entitlements.
// Stresses the variable-length tail parser.
// ----------------------------------------------------------------------

describe('v2 fixture', () => {
  it('parses', () => {
    const parsed = parseLicenseKey(vectors.v2.licenseKey)
    const exp = vectors.v2.expected
    expect(parsed.payload.version).toBe(exp.version)
    expect(parsed.payload.version).toBe(KEY_VERSION_V2)
    expect(parsed.payload.productUuid).toBe(exp.productUuid)
    expect(parsed.payload.licenseUuid).toBe(exp.licenseUuid)
    expect(parsed.payload.issuedAt).toBe(exp.issuedAt)
    expect(parsed.payload.expiresAt).toBe(exp.expiresAt)
    expect(parsed.payload.flags).toBe(exp.flags)
    expect(parsed.payload.isFingerprintBound).toBe(exp.isFingerprintBound)
    expect(parsed.payload.isTrial).toBe(exp.isTrial)
    expect(parsed.payload.entitlements).toEqual(exp.entitlements)
  })

  it('verifies signature', () => {
    const ok = verifier.verify(vectors.v2.licenseKey)
    expect(ok.productId).toBe(vectors.v2.expected.productUuid)
  })

  it('expiry boundary is exact', () => {
    const parsed = parseLicenseKey(vectors.v2.licenseKey)
    const expiresAt = parsed.payload.expiresAt
    expect(isExpiredAt(parsed.payload, expiresAt)).toBe(true)
    expect(isExpiredAt(parsed.payload, expiresAt - 1)).toBe(false)
  })

  it('reports configured entitlements', () => {
    const parsed = parseLicenseKey(vectors.v2.licenseKey)
    for (const slug of vectors.v2.expected.entitlements) {
      expect(hasEntitlement(parsed.payload, slug)).toBe(true)
    }
    expect(
      hasEntitlement(parsed.payload, 'definitely-not-a-real-entitlement'),
    ).toBe(false)
  })
})

// ----------------------------------------------------------------------
// v2_perpetual_unbound — common case for paid purchase: v2, no expiry,
// no fingerprint binding, no entitlements.
// ----------------------------------------------------------------------

describe('v2_perpetual_unbound fixture', () => {
  it('parses if present', () => {
    if (!vectors.v2_perpetual_unbound) return
    const parsed = parseLicenseKey(vectors.v2_perpetual_unbound.licenseKey)
    expect(parsed.payload.version).toBe(2)
    expect(parsed.payload.expiresAt).toBe(0)
    expect(parsed.payload.isFingerprintBound).toBe(false)
  })

  it('verifies if present', () => {
    if (!vectors.v2_perpetual_unbound) return
    const ok = verifier.verify(vectors.v2_perpetual_unbound.licenseKey)
    expect(ok.productId).toBe(
      vectors.v2_perpetual_unbound.expected.productUuid,
    )
  })

  it('never reports expired (perpetual)', () => {
    if (!vectors.v2_perpetual_unbound) return
    const parsed = parseLicenseKey(vectors.v2_perpetual_unbound.licenseKey)
    expect(isExpiredAt(parsed.payload, 9_999_999_999)).toBe(false)
  })
})

// ----------------------------------------------------------------------
// Cross-language fingerprint-hash compatibility.
// ----------------------------------------------------------------------

describe('hashFingerprint', () => {
  it('matches Python stdlib SHA-256 hex output', () => {
    const hashed = bytesToHex(hashFingerprint('hello'))
    // Python: hashlib.sha256(b"hello").hexdigest()
    expect(hashed).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('matches the v1 fixture fingerprint hash', () => {
    const raw = vectors.v1.expected.fingerprintRaw
    if (raw == null) return
    const hashed = bytesToHex(hashFingerprint(raw))
    expect(hashed).toBe(vectors.v1.expected.fingerprintHashHex)
  })
})

// ----------------------------------------------------------------------
// Negative cases.
// ----------------------------------------------------------------------

describe('negative cases', () => {
  it('rejects a too-short key', () => {
    expect(() => parseLicenseKey('notakey')).toThrow(LicensingError)
  })

  it('rejects a wrong prefix', () => {
    expect(() => parseLicenseKey('LIC9-AAAA-BBBB')).toThrow(LicensingError)
  })

  it('rejects an empty string', () => {
    expect(() => parseLicenseKey('')).toThrow(LicensingError)
  })
})
