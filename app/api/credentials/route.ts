import { createHmac, timingSafeEqual } from 'crypto'
import { getCredentials } from '@/lib/storage/neon'
import { decrypt } from '@/lib/crypto'
import { isValidUUID } from '@/lib/validation'
import { errors } from '@/lib/api/response'

/**
 * GET /api/credentials?integrationId=<uuid>
 *
 * Called at runtime by deployed MCP servers to retrieve decrypted API credentials.
 * Requires an HMAC-SHA256 signature so only servers that know CREDENTIAL_HMAC_SECRET
 * can fetch credentials — the same secret is injected into each deployed Vercel project.
 *
 * Expected headers:
 *   x-hmac-signature: hex(HMAC-SHA256(CREDENTIAL_HMAC_SECRET, integrationId))
 *   x-integration-id: <integrationId>
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const integrationId = url.searchParams.get('integrationId') ?? ''

  if (!isValidUUID(integrationId)) {
    return errors.badRequest('Invalid integration ID.')
  }

  const hmacSecret = process.env.CREDENTIAL_HMAC_SECRET

  if (!hmacSecret) {
    console.error('CREDENTIAL_HMAC_SECRET is not set')
    return errors.internal()
  }

  const signature = req.headers.get('x-hmac-signature') ?? ''
  const claimedId = req.headers.get('x-integration-id') ?? ''

  // Reject requests where the header and query param disagree
  if (claimedId !== integrationId) {
    return errors.forbidden()
  }

  // Verify HMAC — must match what the generated server computes:
  // HMAC-SHA256(CREDENTIAL_HMAC_SECRET, integrationId) → hex
  // Constant-time comparison prevents timing side-channel attacks.
  const expected = createHmac('sha256', hmacSecret).update(integrationId).digest('hex')
  const expBuf = Buffer.from(expected, 'hex')
  // Decode submitted signature; substitute a zero buffer if length differs so
  // timingSafeEqual always runs on same-length inputs (prevents timing oracle).
  const rawBuf = Buffer.from(signature, 'hex')
  const sigBuf = rawBuf.length === expBuf.length ? rawBuf : Buffer.alloc(expBuf.length)

  if (!timingSafeEqual(sigBuf, expBuf)) {
    return errors.forbidden()
  }

  const encryptedValue = await getCredentials(integrationId)

  if (!encryptedValue) {
    return errors.notFound('No credentials found.')
  }

  try {
    const parsed = JSON.parse(decrypt(encryptedValue)) as { apiKey: string }

    if (!parsed.apiKey) {
      console.error('Decrypted credential is empty for integration', integrationId)
      return errors.internal()
    }

    return new Response(JSON.stringify({ apiKey: parsed.apiKey }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache',
      },
    })
  } catch {
    return errors.internal()
  }
}
