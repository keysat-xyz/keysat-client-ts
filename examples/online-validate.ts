import { Client } from '@keysat/licensing-client'

const [baseUrl, slug] = process.argv.slice(2)
if (!baseUrl || !slug) {
  throw new Error('usage: tsx online-validate.ts <base-url> <product-slug>')
}

const client = new Client(baseUrl)
const session = await client.startPurchase(slug)
console.log('open the checkout in your browser:')
console.log('  ' + session.checkoutUrl)
console.log('waiting for settlement...')

const key = await client.waitForLicense(session.invoiceId)
console.log('license issued:\n  ' + key)

const v = await client.validate(key, slug)
console.log(`server says: ok=${v.ok} reason=${v.reason ?? '(none)'}`)
