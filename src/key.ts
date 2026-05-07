/**
 * License-key parsing. Matches the service's wire format exactly.
 *
 * ## Wire format
 *
 * A key string looks like `LIC1-<payload_b32>-<signature_b32>`. Both halves
 * are Crockford base32 (no padding) of the raw bytes.
 *
 * ### v1 payload (74 bytes, fixed)
 *
 * ```text
 * offset  size  field
 *      0     1  version = 1
 *      1     1  flags
 *      2    16  product_id (UUID bytes)
 *     18    16  license_id (UUID bytes)
 *     34     8  issued_at   (i64 unix seconds, big-endian)
 *     42    32  fingerprint_hash (SHA-256, or all-zero)
 * ```
 *
 * ### v2 payload (83 bytes + variable entitlements)
 *
 * ```text
 * offset  size  field
 *      0     1  version = 2
 *      1     1  flags
 *      2    16  product_id
 *     18    16  license_id
 *     34     8  issued_at
 *     42     8  expires_at  (i64, 0 = perpetual)
 *     50    32  fingerprint_hash
 *     82     1  num_entitlements (u8)
 *     83     *  entitlements — each: [u8 len][len utf-8 bytes]
 * ```
 *
 * Clients verifying a v1 key treat `expiresAt` as 0 and `entitlements` as
 * empty, so application code can branch on flags / fields uniformly.
 */

import { decodeBase32NoPad } from './base32.js'
import { LicensingError } from './errors.js'

export const KEY_PREFIX = 'LIC1'

/** v1 format identifier. */
export const KEY_VERSION_V1 = 1
/** v2 format identifier. */
export const KEY_VERSION_V2 = 2
/** Highest format version this client understands. */
export const KEY_VERSION = KEY_VERSION_V2

/** Set when the key is bound to a specific machine fingerprint hash. */
export const FLAG_FINGERPRINT_BOUND = 0b0000_0001
/** Set on trial keys. */
export const FLAG_TRIAL = 0b0000_0010

const PAYLOAD_V1_LEN = 74
const PAYLOAD_V2_HEAD_LEN = 83
const SIGNATURE_LEN = 64

/** Decoded fields of the signed payload. */
export interface LicensePayload {
  /** Format version (1 or 2). */
  version: number
  /** Feature flags. */
  flags: number
  /** Raw 16-byte product id (UUID). */
  productId: Uint8Array
  /** Raw 16-byte license id (UUID). */
  licenseId: Uint8Array
  /** Unix seconds issued. */
  issuedAt: number
  /** Unix seconds expiry; `0` for perpetual. Always `0` on v1 keys. */
  expiresAt: number
  /** SHA-256 hash of the bound machine fingerprint, or all-zero. */
  fingerprintHash: Uint8Array
  /** Entitlement slugs granted by this license. Empty on v1 keys. */
  entitlements: string[]
  /** Product UUID in canonical string form. */
  productUuid: string
  /** License UUID in canonical string form. */
  licenseUuid: string
  /** True if the key is fingerprint-bound. */
  isFingerprintBound: boolean
  /** True if the key is flagged as a trial. */
  isTrial: boolean
}

/** A parsed (not yet verified) license key. */
export interface LicenseKey {
  payload: LicensePayload
  /**
   * Raw payload bytes (what the server signed over). Length is 74 on v1,
   * `>= 83` on v2.
   */
  signedBytes: Uint8Array
  /** Raw 64-byte signature. */
  signature: Uint8Array
}

/** True if `nowUnixSeconds` is at or after the key's `expiresAt`. */
export function isExpiredAt(payload: LicensePayload, nowUnixSeconds: number): boolean {
  return payload.expiresAt !== 0 && nowUnixSeconds >= payload.expiresAt
}

/** True if the license grants the given entitlement slug. */
export function hasEntitlement(payload: LicensePayload, slug: string): boolean {
  return payload.entitlements.includes(slug)
}

/** Parse a `LIC1-...-...` string. Does NOT verify. */
export function parseLicenseKey(raw: string): LicenseKey {
  const trimmed = raw.trim()
  const firstDash = trimmed.indexOf('-')
  if (firstDash < 0) throw new LicensingError('bad_format', 'key is missing prefix delimiter')
  const prefix = trimmed.slice(0, firstDash)
  if (prefix !== KEY_PREFIX) throw new LicensingError('bad_format', `unknown key prefix '${prefix}'`)

  const body = trimmed.slice(firstDash + 1)
  const lastDash = body.lastIndexOf('-')
  if (lastDash < 0) throw new LicensingError('bad_format', 'key is missing signature delimiter')

  const payloadB32 = body.slice(0, lastDash)
  const signatureB32 = body.slice(lastDash + 1)

  const payloadBytes = decodeBase32NoPad(payloadB32)
  const signature = decodeBase32NoPad(signatureB32)

  if (signature.length !== SIGNATURE_LEN) {
    throw new LicensingError(
      'bad_format',
      `signature is ${signature.length} bytes; expected ${SIGNATURE_LEN}`,
    )
  }
  if (payloadBytes.length < 1) {
    throw new LicensingError('bad_format', 'empty payload')
  }

  const version = payloadBytes[0]!
  let payload: LicensePayload
  switch (version) {
    case KEY_VERSION_V1:
      payload = parseV1(payloadBytes)
      break
    case KEY_VERSION_V2:
      payload = parseV2(payloadBytes)
      break
    default:
      throw new LicensingError('bad_version', `unsupported key version ${version}`)
  }

  return {
    payload,
    signedBytes: payloadBytes,
    signature,
  }
}

function parseV1(payloadBytes: Uint8Array): LicensePayload {
  if (payloadBytes.length !== PAYLOAD_V1_LEN) {
    throw new LicensingError(
      'bad_format',
      `v1 payload is ${payloadBytes.length} bytes; expected ${PAYLOAD_V1_LEN}`,
    )
  }
  const flags = payloadBytes[1]!
  const productId = payloadBytes.slice(2, 18)
  const licenseId = payloadBytes.slice(18, 34)
  const issuedAt = readBigEndianI64(payloadBytes, 34)
  const fingerprintHash = payloadBytes.slice(42, 74)
  return {
    version: KEY_VERSION_V1,
    flags,
    productId,
    licenseId,
    issuedAt,
    expiresAt: 0,
    fingerprintHash,
    entitlements: [],
    productUuid: uuidString(productId),
    licenseUuid: uuidString(licenseId),
    isFingerprintBound: (flags & FLAG_FINGERPRINT_BOUND) !== 0,
    isTrial: (flags & FLAG_TRIAL) !== 0,
  }
}

function parseV2(payloadBytes: Uint8Array): LicensePayload {
  if (payloadBytes.length < PAYLOAD_V2_HEAD_LEN) {
    throw new LicensingError(
      'bad_format',
      `v2 payload is ${payloadBytes.length} bytes; expected >= ${PAYLOAD_V2_HEAD_LEN}`,
    )
  }
  const flags = payloadBytes[1]!
  const productId = payloadBytes.slice(2, 18)
  const licenseId = payloadBytes.slice(18, 34)
  const issuedAt = readBigEndianI64(payloadBytes, 34)
  const expiresAt = readBigEndianI64(payloadBytes, 42)
  const fingerprintHash = payloadBytes.slice(50, 82)
  const numEntitlements = payloadBytes[82]!

  const entitlements: string[] = []
  let cursor = PAYLOAD_V2_HEAD_LEN
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let i = 0; i < numEntitlements; i++) {
    if (cursor >= payloadBytes.length) {
      throw new LicensingError('bad_format', 'truncated entitlement list')
    }
    const len = payloadBytes[cursor]!
    cursor += 1
    if (cursor + len > payloadBytes.length) {
      throw new LicensingError('bad_format', 'truncated entitlement')
    }
    try {
      entitlements.push(decoder.decode(payloadBytes.slice(cursor, cursor + len)))
    } catch {
      throw new LicensingError('bad_format', 'entitlement not utf-8')
    }
    cursor += len
  }
  if (cursor !== payloadBytes.length) {
    throw new LicensingError('bad_format', 'trailing bytes in payload')
  }

  return {
    version: KEY_VERSION_V2,
    flags,
    productId,
    licenseId,
    issuedAt,
    expiresAt,
    fingerprintHash,
    entitlements,
    productUuid: uuidString(productId),
    licenseUuid: uuidString(licenseId),
    isFingerprintBound: (flags & FLAG_FINGERPRINT_BOUND) !== 0,
    isTrial: (flags & FLAG_TRIAL) !== 0,
  }
}

function readBigEndianI64(buf: Uint8Array, offset: number): number {
  // JavaScript numbers lose precision beyond 2^53 — fine for Unix-second
  // timestamps through the year 2^53 ≈ 285 million AD.
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8)
  const hi = view.getInt32(0, false)
  const lo = view.getUint32(4, false)
  return hi * 2 ** 32 + lo
}

function uuidString(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
