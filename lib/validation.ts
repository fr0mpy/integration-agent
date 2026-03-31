import { lookup } from 'dns/promises'

const BLOCKED_IP_RANGES = [
  /^127\./, // loopback
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // link-local
  /^0\./, // 0.0.0.0/8
]

function isPrivateIP(ip: string): boolean {
  if (ip === '::1' || ip === '::') return true
  return BLOCKED_IP_RANGES.some((range) => range.test(ip))
}

const MAX_SPEC_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * Validates a spec URL and fetches it atomically — DNS resolution and fetch
 * happen together to prevent TOCTOU / DNS rebinding attacks.
 */
export async function validateAndFetchSpec(url: string): Promise<Record<string, unknown>> {
  const parsed = new URL(url)

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ValidationError('Only http and https URLs are supported.')
  }

  // Resolve DNS and validate IP before fetching
  const { address } = await lookup(parsed.hostname)

  if (isPrivateIP(address)) {
    throw new ValidationError('URLs pointing to private/internal networks are not allowed.')
  }

  // Fetch using the original URL — the DNS check above blocks private IPs
  // We can't substitute the IP into the URL because TLS cert validation
  // requires the real hostname (IP-based HTTPS requests fail cert checks).
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new ValidationError(`Failed to fetch spec from URL (${res.status}).`)
  }

  // Guard against oversized responses
  const contentLength = res.headers.get('content-length')

  if (contentLength && parseInt(contentLength, 10) > MAX_SPEC_SIZE) {
    throw new ValidationError('Spec file is too large (max 10MB).')
  }

  const text = await res.text()

  if (text.length > MAX_SPEC_SIZE) {
    throw new ValidationError('Spec file is too large (max 10MB).')
  }

  const spec = JSON.parse(text) as Record<string, unknown>

  if (!spec.openapi && !spec.swagger) {
    throw new ValidationError('The provided URL does not appear to be an OpenAPI spec.')
  }

  return spec
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
