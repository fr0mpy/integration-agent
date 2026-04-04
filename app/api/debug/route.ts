import { BUILD_VERSION } from '@/lib/config'
import { getIntegration, listIntegrations } from '@/lib/storage/neon'
import { mcpConfigCache, redis } from '@/lib/storage/redis'
import { success } from '@/lib/api/response'
import type { MCPServerConfig } from '@/lib/mcp/types'

/**
 * GET /api/debug?id=<integrationId>
 *
 * Diagnostic endpoint — returns build version, Redis connectivity,
 * and cache state for a given integration. Remove before production.
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 })
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  const diag: Record<string, unknown> = {
    buildVersion: BUILD_VERSION,
    timestamp: new Date().toISOString(),
    redisUrl: process.env.KV_REST_API_URL?.slice(0, 30) ?? process.env.UPSTASH_REDIS_REST_URL?.slice(0, 30) ?? 'MISSING',
    redisToken: process.env.KV_REST_API_TOKEN ? 'SET' : process.env.UPSTASH_REDIS_REST_TOKEN ? 'SET' : 'MISSING',
  }

  // Redis ping
  try {
    const pong = await redis.ping()
    diag.redisPing = pong
  } catch (err) {
    diag.redisPing = `ERROR: ${err instanceof Error ? err.message : String(err)}`
  }

  if (id) {
    // Check specific integration
    const integration = await getIntegration(id)
    diag.integration = integration
      ? {
          id: integration.id,
          status: integration.status,
          spec_hash: integration.spec_hash,
          spec_url: integration.spec_url,
          validated_at: integration.validated_at,
          verified_tools_count: Array.isArray(integration.verified_tools) ? integration.verified_tools.length : 0,
        }
      : null

    if (integration?.spec_hash) {
      const config = await mcpConfigCache.get(integration.spec_hash) as MCPServerConfig | null
      const pgConfig = integration.config_json as MCPServerConfig | null
      diag.configInRedis = !!config
      diag.configInPostgres = !!pgConfig
      diag.configToolCount = config?.tools?.length ?? pgConfig?.tools?.length ?? 0
      diag.cacheKey = `cache:v3:${integration.spec_hash}`

      // Also check if the raw key exists in Redis
      try {
        const exists = await redis.exists(`cache:v3:${integration.spec_hash}`)
        diag.rawKeyExists = exists === 1
      } catch (err) {
        diag.rawKeyExists = `ERROR: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  } else {
    // List recent integrations with cache status
    const integrations = await listIntegrations(5)
    const items = []
    for (const i of integrations) {
      const full = await getIntegration(i.id)
      const specHash = (full as Record<string, unknown>)?.spec_hash as string | undefined
      let cached = false
      if (specHash) {
        const config = await mcpConfigCache.get(specHash)
        cached = config !== null
      }
      const pgConfig = !!(full as Record<string, unknown>)?.config_json
      items.push({ id: i.id, status: i.status, spec_hash: specHash?.slice(0, 12), configInRedis: cached, configInPostgres: pgConfig })
    }
    diag.integrations = items
  }

  return success(diag)
}
