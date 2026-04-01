import { getIntegration } from '@/lib/storage/neon'
import { configCache } from '@/lib/storage/redis'
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

    const config = await configCache.get(integration.spec_hash) as MCPServerConfig | null
    if (!config) {
      return errors.notFound('Config not cached yet.')
    }

    const { files } = bundleServer(config)
    return success({ files })
  } catch (err) {
    console.error('Files route error:', err instanceof Error ? err.message : 'unknown')
    return errors.internal()
  }
}
