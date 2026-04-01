import { createHmac } from 'crypto'
import { getCredentials } from '@/lib/storage/neon'
import { decrypt } from '@/lib/crypto'
import { isValidUUID } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'

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
  const expected = createHmac('sha256', hmacSecret).update(integrationId).digest('hex')
  if (signature !== expected) {
    return errors.forbidden()
  }

  const encryptedValue = await getCredentials(integrationId)
  if (!encryptedValue) {
    return errors.notFound('No credentials found.')
  }

  try {
    const parsed = JSON.parse(decrypt(encryptedValue)) as { apiKey: string }
    return success({ apiKey: parsed.apiKey })
  } catch {
    return errors.internal()
  }
}
