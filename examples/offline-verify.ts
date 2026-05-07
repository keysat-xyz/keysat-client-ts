import { PublicKey, Verifier } from '@keysat/licensing-client'

// Paste the issuer's PEM into an env var, or (in production) embed via
// bundler (e.g. Vite `?raw` import, webpack raw-loader, etc.).
const pem = process.env.LICENSING_PUBKEY_PEM
if (!pem) throw new Error('set LICENSING_PUBKEY_PEM')
const keyStr = process.argv[2]
if (!keyStr) throw new Error('pass a license key as an argument')

const verifier = new Verifier(PublicKey.fromPem(pem))
const result = verifier.verify(keyStr)
console.log('license OK')
console.log('  licenseId =', result.licenseId)
console.log('  productId =', result.productId)
console.log('  issuedAt  =', result.payload.issuedAt)
