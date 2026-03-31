import { getIntegration } from '@/lib/storage/neon'
import { specCache, configCache } from '@/lib/storage/redis'
import { discoverEndpoints, enrichDiscovery } from '@/lib/pipeline/discover'
import { success, error, errors } from '@/lib/api/response'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  try {
    const { integrationId } = await params

    if (!UUID_RE.test(integrationId)) {
      return errors.badRequest('Invalid integration ID.')
    }

    const integration = await getIntegration(integrationId)

    if (!integration) {
      return error('Integration not found.', 404)
    }

    const specHash = integration.spec_hash as string

    // Fast path: return cached discovery result
    const cached = await configCache.get(specHash)

    if (cached) {
      return success(cached)
    }

    // Slow path: fetch spec, run discovery + enrichment
    const spec = await specCache.get(specHash)

    if (!spec) {
      return error('Spec not found — it may have expired.', 404)
    }

    const raw = await discoverEndpoints(spec)
    const result = await enrichDiscovery(raw)

    // Cache for future requests
    await configCache.set(specHash, result)

    return success(result)
  } catch (err) {
    console.error('Pipeline error:', err instanceof Error ? err.message : 'unknown')
    return errors.internal()
  }
}
