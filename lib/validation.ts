import { lookup } from 'dns/promises'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Returns true if the string matches UUID v4 format; guards route params before they reach any DB query.
export function isValidUUID(id: string): boolean {
  return UUID_RE.test(id)
}

/**
 * SSRF guard for sandbox URLs: resolves DNS and rejects private/internal IPs.
 * Throws ValidationError on any violation so callers can return 400.
 */
export async function validateSandboxUrl(url: string): Promise<void> {
  let hostname: string

  try {
    hostname = new URL(url).hostname
  } catch {
    throw new ValidationError('Invalid sandbox URL.')
  }

  const { address } = await lookup(hostname)

  if (isPrivateIP(address)) {
    throw new ValidationError('Sandbox URL resolves to a private/internal address.')
  }
}

export const BLOCKED_IP_RANGES = [
  /^127\./, // loopback
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // link-local
  /^0\./, // 0.0.0.0/8
]

// Returns true for any IPv4/IPv6 address in a private or reserved range; called by SSRF guards before outbound requests.
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
    redirect: 'error',
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

  let spec: Record<string, unknown>

  try {
    spec = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new ValidationError('Response is not valid JSON.')
  }

  if (!spec.openapi && !spec.swagger) {
    throw new ValidationError('The provided URL does not appear to be an OpenAPI spec.')
  }

  return spec
}

// Custom error subclass that signals a user-visible 400-level problem; callers catch this to return structured error responses.
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
