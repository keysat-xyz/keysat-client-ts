/** Offline Ed25519 signature verification. */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'
import { LicensingError } from './errors.js'
import { parseLicenseKey, isExpiredAt, type LicensePayload } from './key.js'
import { PublicKey } from './pubkey.js'
import { hashFingerprint } from './fingerprint.js'

// `@noble/ed25519` requires us to plug in a hash function. This is a one-time
// init on module load; downstream callers don't need to care.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

export interface VerifyOk {
  /** Parsed payload fields. */
  payload: LicensePayload
  /** License UUID as a canonical string. */
  licenseId: string
  /** Product UUID as a canonical string. */
  productId: string
}

/** Verifies license keys against a single issuing server's public key. */
export class Verifier {
  private pubkey: PublicKey

  constructor(pubkey: PublicKey) {
    this.pubkey = pubkey
  }

  /** Verify a license key string. Throws on any failure. */
  verify(keyStr: string): VerifyOk {
    const key = parseLicenseKey(keyStr)
    const ok = ed.verify(key.signature, key.signedBytes, this.pubkey.raw)
    if (!ok) throw new LicensingError('bad_signature', 'signature did not verify')
    return {
      payload: key.payload,
      licenseId: key.payload.licenseUuid,
      productId: key.payload.productUuid,
    }
  }

  /**
   * Verify AND enforce that, if the key is fingerprint-bound, the given
   * fingerprint matches. If the key is not bound, the fingerprint is
   * ignored. Throws on any failure.
   */
  verifyWithFingerprint(keyStr: string, fingerprint: string): VerifyOk {
    const result = this.verify(keyStr)
    if (result.payload.isFingerprintBound) {
      const expected = hashFingerprint(fingerprint)
      const stored = result.payload.fingerprintHash
      if (!equalBytes(expected, stored)) {
        throw new LicensingError('bad_signature', 'fingerprint does not match bound key')
      }
    }
    return result
  }

  /**
   * Verify a key and additionally reject it with an `expired` error if
   * `nowUnixSeconds` is at or past its `expiresAt`. Perpetual keys
   * (`expiresAt === 0`) are accepted regardless of `nowUnixSeconds`. This is
   * offline-only — no grace window logic; use `Client.validate` for that.
   */
  verifyWithTime(keyStr: string, nowUnixSeconds: number): VerifyOk {
    const result = this.verify(keyStr)
    if (isExpiredAt(result.payload, nowUnixSeconds)) {
      throw new LicensingError('expired', 'license has expired')
    }
    return result
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}
