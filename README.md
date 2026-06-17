# @keysat/licensing-client

TypeScript / JavaScript client for [`Keysat`](https://github.com/keysat-xyz/keysat) — a Bitcoin-native self-hosted software licensing service that runs on Start9.

Works in modern browsers and Node 18+. No native dependencies; signature verification is done in pure JS via [`@noble/ed25519`](https://github.com/paulmillr/noble-ed25519).

## What you get

- **Offline verification**: check a license key with just the issuing server's public key. No network. Optional local fingerprint and expiry enforcement.
- **Online validation**: live revocation check and fingerprint binding via the service's `/v1/validate` endpoint.
- **Purchase flow**: kick off a BTCPay checkout and poll for the issued key.
- **Free licenses**: redeem a free-license code, no payment.
- **Tiers**: list a product's public tiers for an in-app picker.
- **Machine/seat management**: activate, heartbeat, and deactivate seats.

## Install

```bash
npm install @keysat/licensing-client
```

## 5-line offline check

```ts
import { Verifier, PublicKey } from '@keysat/licensing-client'

const verifier = new Verifier(PublicKey.fromPem(ISSUER_PUBKEY_PEM))
const ok = verifier.verify(keyFromUser)
console.log('licensed for product', ok.productId)
```

That's the whole integration. Embed your public key as a string at build time (e.g. Vite's `?raw` import, webpack raw-loader, or just a `const`). If the verifier returns without throwing, the key is real and was issued by you.

### Local fingerprint and expiry enforcement

Two offline variants enforce more without a network call:

```ts
// Throws if the key is fingerprint-bound and the machine doesn't match.
// (Unbound keys ignore the fingerprint.)
verifier.verifyWithFingerprint(keyFromUser, machineFingerprint)

// Throws `expired` if now is at or past the key's expiry. Perpetual
// keys (expiresAt === 0) always pass. No grace-window logic offline;
// use `Client.validate` for that.
verifier.verifyWithTime(keyFromUser, Math.floor(Date.now() / 1000))
```

## 10-line online check (with revocation + fingerprint)

```ts
import { Client } from '@keysat/licensing-client'

const client = new Client('https://license.example.com')
// Current form: pass an options object. The positional form
// `validate(key, productSlug, fingerprint)` still works for backwards compatibility.
const result = await client.validate(keyFromUser, { productSlug: 'my-product', fingerprint: machineFingerprint })
if (!result.ok) {
  console.error('rejected:', result.reason)
  process.exit(1)
}
```

The server enforces revocation live and does trust-on-first-use fingerprint binding, so the same key used from a second machine gets rejected.

## Purchase flow

```ts
const session = await client.startPurchase('my-product')
console.log('pay at:', session.checkoutUrl)
const key = await client.waitForLicense(session.invoiceId)
console.log('got license:', key)
```

`waitForLicense` polls until the BTCPay invoice settles and the service issues a key. It throws if the invoice expires or becomes invalid.

## Free licenses

Redeem a free-license code (the Creator-tier onboarding path) to get a signed key directly, with no BTCPay checkout:

```ts
const { licenseKey } = await client.redeemFreeLicense('my-product', 'CODE-1234')
verifier.verify(licenseKey) // offline-verifiable like any issued key
```

Throws if the code is unknown, disabled, expired, for another product, not a free-license code, or capped out. Optional `{ buyerEmail, buyerNote }` third argument is recorded on the issued license.

## Tiers

List a product's public tiers (no auth) to build an in-app tier picker that stays in sync with the operator's admin setup:

```ts
const { product, policies } = await client.listPublicPolicies('my-product')
for (const p of policies) {
  console.log(p.name, p.slug, p.priceSats, p.entitlements)
}
```

Each policy carries slug, name, price (in the product currency's smallest unit, sats or cents), duration, seat cap, entitlements, and trial/recurring flags. Pass the chosen `slug` to `startPurchase(slug, { policySlug })` so the invoice is priced and the issued license is provisioned for that tier.

## Machine/seat management

For per-seat enforcement, manage machines explicitly. All three return a `MachineResponse` (`{ ok, reason?, machineId?, activeCount?, maxMachines? }`):

```ts
await client.activate(key, fingerprint, { hostname, platform }) // claim a seat
await client.heartbeat(key, fingerprint)                        // mark the seat alive
await client.deactivate(key, fingerprint, 'user signed out')    // free the seat
```

`validate` already binds a seat on first use when you pass a fingerprint; reach for these when you want explicit activate/deactivate lifecycle or periodic liveness pings.

## Examples

Runnable end-to-end scripts live in [`examples/`](./examples): `offline-verify.ts` and `online-validate.ts` (the latter walks purchase to `waitForLicense` to `validate`).

## Browser usage

Everything here works in the browser too. Drop the library into your React/Svelte/Vue app and run offline verification client-side — no server call needed for the common case.

```ts
// Vite: import the PEM as a raw string at build time
import issuerPem from './issuer.pub?raw'
import { Verifier, PublicKey } from '@keysat/licensing-client'

const verifier = new Verifier(PublicKey.fromPem(issuerPem))
```

## License

MIT.
