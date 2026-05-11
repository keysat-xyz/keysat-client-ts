# @keysat/licensing-client

TypeScript / JavaScript client for [`Keysat`](https://github.com/keysat-xyz/keysat) — a Bitcoin-native self-hosted software licensing service that runs on Start9.

Works in modern browsers and Node 18+. No native dependencies; signature verification is done in pure JS via [`@noble/ed25519`](https://github.com/paulmillr/noble-ed25519).

## What you get

- **Offline verification**: check a license key with just the issuing server's public key. No network.
- **Online validation**: live revocation check and fingerprint binding via the service's `/v1/validate` endpoint.
- **Purchase flow**: kick off a BTCPay checkout and poll for the issued key.

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

## 10-line online check (with revocation + fingerprint)

```ts
import { Client } from '@keysat/licensing-client'

const client = new Client('https://license.example.com')
const result = await client.validate(keyFromUser, 'my-product', machineFingerprint)
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
