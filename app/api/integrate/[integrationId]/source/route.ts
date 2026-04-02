import { z } from 'zod'
import { getIntegration } from '@/lib/storage/neon'
import { sourceOverride } from '@/lib/storage/redis'
import { isValidUUID } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'

const MAX_SOURCE_LENGTH = 512_000 // ~500KB

const bodySchema = z.object({
  source: z.string().min(1).max(MAX_SOURCE_LENGTH),
})

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  try {
    const { integrationId } = await params

    if (!isValidUUID(integrationId)) {
      return errors.badRequest('Invalid integration ID.')
    }

    const integration = await getIntegration(integrationId)

    if (!integration) {
      return errors.notFound('Integration not found.')
    }

    const raw = await req.json()
    const parsed = bodySchema.safeParse(raw)

    if (!parsed.success) {
      return errors.badRequest('Invalid request body.')
    }

    await sourceOverride.set(integrationId, parsed.data.source)
    return success({ ok: true })
  } catch (err) {
    console.error('Source PUT error:', err instanceof Error ? err.message : 'unknown')
    return errors.internal()
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  try {
    const { integrationId } = await params

    if (!isValidUUID(integrationId)) {
      return errors.badRequest('Invalid integration ID.')
    }

    const integration = await getIntegration(integrationId)

    if (!integration) {
      return errors.notFound('Integration not found.')
    }

    await sourceOverride.del(integrationId)
    return success({ ok: true })
  } catch (err) {
    console.error('Source DELETE error:', err instanceof Error ? err.message : 'unknown')
    return errors.internal()
  }
}
