/** Hash a raw fingerprint string to the 32-byte form embedded in keys. */

import { sha256 } from '@noble/hashes/sha256'

export function hashFingerprint(raw: string): Uint8Array {
  return sha256(new TextEncoder().encode(raw))
}
