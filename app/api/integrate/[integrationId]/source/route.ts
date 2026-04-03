import { z } from 'zod'
import { getIntegration } from '@/lib/storage/neon'
import { sourceOverride } from '@/lib/storage/redis'
import { isValidUUID } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'
import { config } from '@/lib/config'

const MAX_SOURCE_LENGTH = config.validation.maxSourceLength

// Env vars the generated template is allowed to read — everything else is blocked
const ALLOWED_ENV_VARS = new Set([
  'MCP_BASE_URL',
  'CREDENTIAL_ENDPOINT',
  'HMAC_SECRET',
  'INTEGRATION_ID',
])

// Reject source code that contains suspicious patterns indicative of code injection
const BLOCKED_PATTERNS = [
  /child_process/,        // shell spawning
  /\beval\s*\(/,          // eval execution
  /Function\s*\(/,        // dynamic function construction
  /require\s*\(\s*['"`]/,  // dynamic requires
]

// Matches process.env.VAR_NAME — captures the var name for allowlist check
const PROCESS_ENV_RE = /process\.env\.(\w+)/g

const bodySchema = z.object({
  source: z.string().min(1).max(MAX_SOURCE_LENGTH).refine(
    (s) => s.includes('server.tool(') || s.includes('server.tool ('),
    { message: 'Source must contain at least one server.tool() registration.' },
  ).refine(
    (s) => !BLOCKED_PATTERNS.some((p) => p.test(s)),
    { message: 'Source contains blocked patterns.' },
  ).refine(
    (s) => {
      const matches = s.matchAll(PROCESS_ENV_RE)
      for (const m of matches) {
        if (!ALLOWED_ENV_VARS.has(m[1])) return false
      }
      return true
    },
    { message: 'Source references disallowed environment variables.' },
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
