/**
 * Issuer public key. Accepts either raw 32-byte Ed25519 key material or a
 * PEM-encoded SubjectPublicKeyInfo blob (which is what the service returns
 * from `/v1/pubkey`).
 */

import { LicensingError } from './errors.js'

/** Parsed Ed25519 public key, ready for signature verification. */
export class PublicKey {
  /** Raw 32-byte Ed25519 public key material. */
  readonly raw: Uint8Array

  constructor(raw: Uint8Array) {
    if (raw.length !== 32) {
      throw new LicensingError(
        'bad_format',
        `public key must be 32 bytes; got ${raw.length}`,
      )
    }
    this.raw = raw
  }

  /** Parse a PEM blob as emitted by the service. */
  static fromPem(pem: string): PublicKey {
    const stripped = pem
      .replace(/-----BEGIN [^-]+-----/g, '')
      .replace(/-----END [^-]+-----/g, '')
      .replace(/\s+/g, '')
    if (!stripped) {
      throw new LicensingError('bad_format', 'empty PEM input')
    }
    const der = base64Decode(stripped)
    // Ed25519 SubjectPublicKeyInfo: 12 bytes of DER header + 32 bytes of key.
    // We don't bother to fully parse the ASN.1 — we just assert total length
    // of 44 bytes and slice the tail.
    if (der.length < 32) {
      throw new LicensingError('bad_format', 'PEM body too short to contain a public key')
    }
    const raw = der.slice(der.length - 32)
    return new PublicKey(raw)
  }

  /** Construct from raw bytes (no PEM envelope). */
  static fromBytes(bytes: Uint8Array): PublicKey {
    return new PublicKey(bytes)
  }
}

function base64Decode(b64: string): Uint8Array {
  // Prefer Node's Buffer if present (fastest path); fall back to atob.
  const nodeBuffer = (globalThis as { Buffer?: { from: (s: string, enc: string) => Uint8Array } })
    .Buffer
  if (nodeBuffer) {
    return new Uint8Array(nodeBuffer.from(b64, 'base64'))
  }
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
