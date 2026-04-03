import { getIntegration } from '@/lib/storage/neon'
import { mcpConfigCache, sourceOverride } from '@/lib/storage/redis'
import { bundleServer } from '@/lib/mcp/bundle'
import { isValidUUID } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'
import type { MCPServerConfig } from '@/lib/mcp/types'

export async function GET(
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

    // Try Redis first, fall back to Postgres (Redis writes unreliable inside WDK steps)
    let config = await mcpConfigCache.get(integration.spec_hash) as MCPServerConfig | null
    if (!config && integration.config_json) config = integration.config_json as MCPServerConfig

    if (!config) {
      return errors.notFound('Config not cached yet.')
    }

    const { files } = bundleServer(config)

    const override = await sourceOverride.get(integrationId)

    if (override) {
      const idx = files.findIndex(f => f.file === 'app/[transport]/route.ts')
      if (idx >= 0) files[idx] = { ...files[idx], data: override }
    }

    return success({ files })
  } catch (err) {
    console.error('Files route error:', err instanceof Error ? err.message : 'unknown')
    return errors.internal()
  }
}
