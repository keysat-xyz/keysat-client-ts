/**
 * RFC 4648 base32 (no padding), uppercase alphabet. Matches the `BASE32_NOPAD`
 * encoder used by the Rust service. Implemented inline so we don't pull in a
 * 300-line dependency.
 */

import { LicensingError } from './errors.js'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const DECODE_TABLE: Record<string, number> = (() => {
  const t: Record<string, number> = {}
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET[i]!] = i
  return t
})()

export function decodeBase32NoPad(input: string): Uint8Array {
  const up = input.toUpperCase()
  const out = new Uint8Array(Math.floor((up.length * 5) / 8))
  let bits = 0
  let value = 0
  let outPos = 0
  for (let i = 0; i < up.length; i++) {
    const ch = up[i]!
    const v = DECODE_TABLE[ch]
    if (v === undefined) {
      throw new LicensingError('bad_encoding', `invalid base32 character '${ch}'`)
    }
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out[outPos++] = (value >> bits) & 0xff
    }
  }
  return out.subarray(0, outPos)
}
