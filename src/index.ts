/**
 * @keysat/licensing-client
 *
 * Client for Keysat. Works in both Node.js (>= 18) and modern
 * browsers with no polyfills thanks to the `@noble/*` primitives.
 */

export { Verifier, type VerifyOk } from './verify.js'
export {
  Client,
  type ValidateResponse,
  type ValidateOptions,
  type MachineResponse,
  type PurchaseSession,
  type PollResponse,
  type StartPurchaseOptions,
  type PublicPolicy,
  type PublicPoliciesResponse,
  type EntitlementDef,
  type RedeemFreeOptions,
  type RedeemFreeResponse,
} from './online.js'
export {
  parseLicenseKey,
  isExpiredAt,
  hasEntitlement,
  type LicenseKey,
  type LicensePayload,
  KEY_PREFIX,
  KEY_VERSION,
  KEY_VERSION_V1,
  KEY_VERSION_V2,
  FLAG_FINGERPRINT_BOUND,
  FLAG_TRIAL,
} from './key.js'
export { PublicKey } from './pubkey.js'
export { hashFingerprint } from './fingerprint.js'
export { LicensingError } from './errors.js'
