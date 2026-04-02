import { z } from 'zod'
import { getIntegration, hasCredentials, saveCredentials } from '@/lib/storage/neon'
import { encrypt } from '@/lib/crypto'
import { isValidUUID } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'

const postSchema = z.object({
  credential: z.string().min(1).max(512),
})

async function resolveId(params: Promise<{ integrationId: string }>): Promise<string | null> {
  const { integrationId } = await params
  return isValidUUID(integrationId) ? integrationId : null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  const integrationId = await resolveId(params)
  if (!integrationId) return errors.badRequest('Invalid integration ID.')

  const exists = await hasCredentials(integrationId)
  return success({ hasCredentials: exists })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  const integrationId = await resolveId(params)
  if (!integrationId) return errors.badRequest('Invalid integration ID.')

  const integration = await getIntegration(integrationId)

  if (!integration) {
    return errors.notFound('Integration not found.')
  }

  const raw = await req.json()
  const parsed = postSchema.safeParse(raw)

  if (!parsed.success) {
    return errors.badRequest('Invalid request.')
  }

  const encryptedValue = encrypt(JSON.stringify({ apiKey: parsed.data.credential }))
  const ok = await saveCredentials(integrationId, encryptedValue)

  if (!ok) {
    return errors.internal()
  }

  return success({ ok: true })
}
