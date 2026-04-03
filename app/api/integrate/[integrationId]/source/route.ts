import { z } from 'zod'
import { getIntegration } from '@/lib/storage/neon'
import { sourceOverride } from '@/lib/storage/redis'
import { isValidUUID } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'

const MAX_SOURCE_LENGTH = 512_000 // ~500KB

// Reject source code that contains suspicious patterns indicative of code injection
const BLOCKED_PATTERNS = [
  /process\.env/,         // env var exfiltration
  /child_process/,        // shell spawning
  /\beval\s*\(/,          // eval execution
  /Function\s*\(/,        // dynamic function construction
  /require\s*\(\s*['"`]/,  // dynamic requires
]

const bodySchema = z.object({
  source: z.string().min(1).max(MAX_SOURCE_LENGTH).refine(
    (s) => s.includes('server.tool(') || s.includes('server.tool ('),
    { message: 'Source must contain at least one server.tool() registration.' },
  ).refine(
    (s) => !BLOCKED_PATTERNS.some((p) => p.test(s)),
    { message: 'Source contains blocked patterns.' },
  ),
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
