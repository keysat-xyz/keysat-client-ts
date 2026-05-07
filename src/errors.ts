/** All errors thrown by this library inherit from `LicensingError`. */
export class LicensingError extends Error {
  /**
   * Machine-readable reason code. Common values:
   * `"bad_format"`, `"bad_encoding"`, `"bad_version"`, `"bad_signature"`,
   * `"expired"`, `"server_error"`, `"http_error"`, `"other"`.
   */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'LicensingError'
    this.code = code
  }
}
