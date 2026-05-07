/**
 * Online operations against a running `licensing-service` instance.
 *
 * All methods use the global `fetch` available in Node 18+ and every modern
 * browser. No additional runtime required.
 */

import { LicensingError } from './errors.js'

export interface ValidateResponse {
  ok: boolean
  /**
   * Machine-readable reason on failure. One of:
   * `bad_format`, `bad_signature`, `not_found`, `revoked`, `suspended`,
   * `expired`, `product_mismatch`, `fingerprint_mismatch`,
   * `too_many_machines`, `rate_limited`, `invalid_state`.
   */
  reason?: string
  licenseId?: string
  productId?: string
  productSlug?: string
  issuedAt?: string
  /** Expiry timestamp (RFC 3339) if the license has one. */
  expiresAt?: string
  /** End of the grace window (RFC 3339) when in a grace period. */
  graceUntil?: string
  /** True when the key is past `expiresAt` but still inside the grace window. */
  inGracePeriod?: boolean
  /** True if this license is flagged as a trial. */
  isTrial?: boolean
  /** Entitlement slugs granted by the license. */
  entitlements?: string[]
  /** License status string: `active`, `suspended`, `revoked`. */
  status?: string
  /** Machine id created or matched by this call (when fingerprint was sent). */
  machineId?: string
  /** Seat cap: `0` unlimited, `1` single-seat, `n` n-seat. */
  maxMachines?: number
}

export interface ValidateOptions {
  /** Product slug the caller expects the key to cover. */
  productSlug?: string
  /** Raw machine fingerprint; enables seat binding / cap enforcement. */
  fingerprint?: string
  /** Client-supplied hostname, stored against the machine row on activation. */
  hostname?: string
  /** Client-supplied platform descriptor, e.g. `'linux-x86_64'`. */
  platform?: string
}

export interface MachineResponse {
  ok: boolean
  reason?: string
  machineId?: string
  activeCount?: number
  maxMachines?: number
}

export interface PurchaseSession {
  /** Our internal invoice id — use with `pollPurchase`. */
  invoiceId: string
  /** BTCPay's invoice id (opaque). */
  btcpayInvoiceId: string
  /** URL to open in the buyer's browser to pay. */
  checkoutUrl: string
  /** Price in satoshis. */
  amountSats: number
  /** Where the service recommends polling. */
  pollUrl: string
}

export interface PollResponse {
  invoiceId: string
  /** `pending | settled | expired | invalid`. */
  status: string
  productId: string
  amountSats: number
  /** Populated once the license has been issued. */
  licenseKey?: string
  licenseId?: string
}

export interface StartPurchaseOptions {
  /** Optional email for the receipt. */
  buyerEmail?: string
  /** Optional URL the buyer should be returned to after payment. */
  redirectUrl?: string
  /** Optional discount / referral code. */
  code?: string
  /** Optional buyer note recorded on the invoice (admin-visible). */
  buyerNote?: string
}

export interface RedeemFreeOptions {
  /** Optional email recorded on the synthetic invoice + license. */
  buyerEmail?: string
  /** Optional buyer note. */
  buyerNote?: string
}

export interface RedeemFreeResponse {
  licenseId: string
  /** The fully-signed license key, ready for offline verification. */
  licenseKey: string
  invoiceId: string
  redemptionId: string
}

/** An HTTP client pinned to one licensing-service base URL. */
export class Client {
  private base: string

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/+$/, '')
  }

  /** The normalized base URL this client is pinned to. */
  baseUrl(): string {
    return this.base
  }

  /** Fetch the server's PEM-encoded public key. */
  async fetchPubkeyPem(): Promise<string> {
    const data = await this.get<{ public_key_pem: string }>('/v1/pubkey')
    return data.public_key_pem
  }

  /**
   * Server-authoritative validation. Returns the full response including
   * expiry / entitlements / seat fields introduced in v2.
   *
   * Two-argument form kept for call-site compatibility with earlier SDK
   * versions; pass an options object for the full set of fields.
   */
  async validate(
    key: string,
    productSlugOrOptions?: string | ValidateOptions,
    fingerprint?: string,
  ): Promise<ValidateResponse> {
    const opts: ValidateOptions =
      typeof productSlugOrOptions === 'string'
        ? { productSlug: productSlugOrOptions, fingerprint }
        : productSlugOrOptions ?? {}
    const raw = await this.post<Record<string, unknown>>('/v1/validate', {
      key,
      product_slug: opts.productSlug,
      fingerprint: opts.fingerprint,
      hostname: opts.hostname,
      platform: opts.platform,
    })
    return this.toValidateResponse(raw)
  }

  /** Lightweight heartbeat. Server updates `last_heartbeat_at`. */
  async heartbeat(key: string, fingerprint: string): Promise<MachineResponse> {
    const raw = await this.post<Record<string, unknown>>('/v1/machines/heartbeat', {
      key,
      fingerprint,
    })
    return this.toMachineResponse(raw)
  }

  /** Explicitly activate a seat for the given fingerprint. */
  async activate(
    key: string,
    fingerprint: string,
    opts: { hostname?: string; platform?: string } = {},
  ): Promise<MachineResponse> {
    const raw = await this.post<Record<string, unknown>>('/v1/machines/activate', {
      key,
      fingerprint,
      hostname: opts.hostname,
      platform: opts.platform,
    })
    return this.toMachineResponse(raw)
  }

  /** Free a seat held by the given fingerprint. */
  async deactivate(
    key: string,
    fingerprint: string,
    reason?: string,
  ): Promise<MachineResponse> {
    const raw = await this.post<Record<string, unknown>>('/v1/machines/deactivate', {
      key,
      fingerprint,
      reason,
    })
    return this.toMachineResponse(raw)
  }

  /** Start a purchase. Returns the checkout URL and invoice id. */
  async startPurchase(
    productSlug: string,
    opts: StartPurchaseOptions = {},
  ): Promise<PurchaseSession> {
    const raw = await this.post<Record<string, unknown>>('/v1/purchase', {
      product: productSlug,
      buyer_email: opts.buyerEmail,
      buyer_note: opts.buyerNote,
      redirect_url: opts.redirectUrl,
      code: opts.code,
    })
    return {
      invoiceId: raw.invoice_id as string,
      btcpayInvoiceId: raw.btcpay_invoice_id as string,
      checkoutUrl: raw.checkout_url as string,
      amountSats: raw.amount_sats as number,
      pollUrl: raw.poll_url as string,
    }
  }

  /**
   * Redeem a `free_license` code: bypass BTCPay entirely and receive the
   * signed license key directly. Throws if the code is unknown / disabled
   * / expired / wrong product / not a free_license code, or if the cap
   * has been reached.
   */
  async redeemFreeLicense(
    productSlug: string,
    code: string,
    opts: RedeemFreeOptions = {},
  ): Promise<RedeemFreeResponse> {
    const raw = await this.post<Record<string, unknown>>('/v1/redeem', {
      product: productSlug,
      code,
      buyer_email: opts.buyerEmail,
      buyer_note: opts.buyerNote,
    })
    return {
      licenseId: raw.license_id as string,
      licenseKey: raw.license_key as string,
      invoiceId: raw.invoice_id as string,
      redemptionId: raw.redemption_id as string,
    }
  }

  /** Poll a purchase by its invoice id. */
  async pollPurchase(invoiceId: string): Promise<PollResponse> {
    const raw = await this.get<Record<string, unknown>>(
      `/v1/purchase/${encodeURIComponent(invoiceId)}`,
    )
    return {
      invoiceId: raw.invoice_id as string,
      status: raw.status as string,
      productId: raw.product_id as string,
      amountSats: raw.amount_sats as number,
      licenseKey: (raw.license_key as string | null) ?? undefined,
      licenseId: (raw.license_id as string | null) ?? undefined,
    }
  }

  /**
   * Convenience: open the checkout, poll until a license key is issued,
   * then return it. Suitable for CLI usage or for an app UI that shows a
   * spinner while the buyer pays.
   */
  async waitForLicense(
    invoiceId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<string> {
    const interval = options.intervalMs ?? 5000
    const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : Infinity
    while (true) {
      const poll = await this.pollPurchase(invoiceId)
      if (poll.licenseKey) return poll.licenseKey
      if (poll.status === 'expired' || poll.status === 'invalid') {
        throw new LicensingError('server_error', `invoice ended in status ${poll.status}`)
      }
      if (Date.now() > deadline) {
        throw new LicensingError('server_error', 'timed out waiting for license issuance')
      }
      await sleep(interval)
    }
  }

  // --- internals ---

  private toValidateResponse(raw: Record<string, unknown>): ValidateResponse {
    const entitlements = Array.isArray(raw.entitlements)
      ? (raw.entitlements as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined
    return {
      ok: !!raw.ok,
      reason: raw.reason as string | undefined,
      licenseId: raw.license_id as string | undefined,
      productId: raw.product_id as string | undefined,
      productSlug: raw.product_slug as string | undefined,
      issuedAt: raw.issued_at as string | undefined,
      expiresAt: raw.expires_at as string | undefined,
      graceUntil: raw.grace_until as string | undefined,
      inGracePeriod: raw.in_grace_period as boolean | undefined,
      isTrial: raw.is_trial as boolean | undefined,
      entitlements,
      status: raw.status as string | undefined,
      machineId: raw.machine_id as string | undefined,
      maxMachines: raw.max_machines as number | undefined,
    }
  }

  private toMachineResponse(raw: Record<string, unknown>): MachineResponse {
    return {
      ok: !!raw.ok,
      reason: raw.reason as string | undefined,
      machineId: raw.machine_id as string | undefined,
      activeCount: raw.active_count as number | undefined,
      maxMachines: raw.max_machines as number | undefined,
    }
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' })
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let resp: Response
    try {
      resp = await fetch(`${this.base}${path}`, init)
    } catch (e) {
      throw new LicensingError('http_error', e instanceof Error ? e.message : String(e))
    }
    const text = await resp.text()
    if (!resp.ok) {
      throw new LicensingError('server_error', `HTTP ${resp.status}: ${text}`)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new LicensingError('server_error', `non-JSON response: ${text}`)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}
