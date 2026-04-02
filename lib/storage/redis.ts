import { createHash } from 'crypto'
import { Redis } from '@upstash/redis'

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN

if (!redisUrl || !redisToken) {
  console.error('Redis env vars not configured (UPSTASH_REDIS_REST_URL / KV_REST_API_URL)')
}

export const redis = new Redis({
  url: redisUrl ?? '',
  token: redisToken ?? '',
})

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

// Wraps any Redis call in a try/catch; returns null on failure so cache misses never crash the pipeline.
async function safeRedis<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    console.warn(`Redis ${label} failed:`, err instanceof Error ? err.message : 'unknown')
    return null
  }
}

// SHA-256 hashes a spec URL to a fixed-length key safe for Redis storage; prevents key length issues with long URLs.
function hashUrl(specUrl: string): string {
  return createHash('sha256').update(specUrl).digest('hex')
}

// Spec URL index: maps a spec URL to its content hash so fast-path lookups can detect spec changes without re-fetching.
export const specUrlIndex = {
  // Looks up the stored hash for a URL; a hit means we've processed this URL before and can compare content hashes.
  getHash(specUrl: string) {
    return safeRedis('specUrlIndex read', () => redis.get<string>(`url:${hashUrl(specUrl)}`))
  },

  // Stores the URL→hash mapping with a 30-day TTL; written last after synthesis results are cached (commit signal).
  setHash(specUrl: string, specHash: string) {
    return safeRedis('specUrlIndex write', () =>
      redis.set(`url:${hashUrl(specUrl)}`, specHash, { ex: CACHE_TTL_SECONDS }),
    )
  },
}

// MCP config cache: stores validated MCPServerConfig keyed by spec hash to skip re-synthesis on unchanged specs.
export const mcpConfigCache = {
  // Reads a previously validated MCPServerConfig; a hit allows the pipeline to skip synthesis and sandbox entirely.
  get(specHash: string) {
    return safeRedis('mcpConfigCache read', () => redis.get(`cache:${specHash}`))
  },

  // Persists a validated config keyed by spec hash; only written after sandbox validation passes.
  set(specHash: string, config: unknown) {
    return safeRedis('mcpConfigCache write', () =>
      redis.set(`cache:${specHash}`, config, { ex: CACHE_TTL_SECONDS }),
    )
  },
}

// Discovery cache: stores parsed DiscoveryResult keyed by spec hash so endpoint scraping is not repeated.
export const discoveryCache = {
  // Reads a previously parsed DiscoveryResult; a hit skips the discover step on unchanged specs.
  get(specHash: string) {
    return safeRedis('discovery read', () => redis.get(`discovery:${specHash}`))
  },

  // Persists discovery output keyed by spec hash; avoids re-scraping the spec on every pipeline trigger.
  set(specHash: string, discovery: unknown) {
    return safeRedis('discovery write', () =>
      redis.set(`discovery:${specHash}`, discovery, { ex: CACHE_TTL_SECONDS }),
    )
  },
}

// Source override: stores user-edited MCP server source for an integration so edits survive across audit re-triggers.
export const sourceOverride = {
  // Reads a user-edited source file for an integration; checked before each re-audit so manual fixes are preserved.
  get(integrationId: string) {
    return safeRedis('sourceOverride read', () => redis.get<string>(`sourceOverride:${integrationId}`))
  },

  // Saves a user-edited source to Redis so it survives across audit re-triggers and page reloads.
  set(integrationId: string, source: string) {
    return safeRedis('sourceOverride write', () =>
      redis.set(`sourceOverride:${integrationId}`, source, { ex: CACHE_TTL_SECONDS }),
    )
  },

  // Clears the source override once it has been consumed by the audit step, preventing stale edits from persisting.
  del(integrationId: string) {
    return safeRedis('sourceOverride delete', () => redis.del(`sourceOverride:${integrationId}`))
  },
}

export const lock = {
  /** Acquire a distributed lock. Returns true if acquired, false if already held. */
  async acquire(key: string, ttlMs = 120_000): Promise<boolean> {
    const result = await safeRedis('lock acquire', () =>
      redis.set(`lock:${key}`, '1', { px: ttlMs, nx: true }),
    )
    return result === 'OK'
  },

  // Releases a distributed lock by deleting the key; called after the pipeline step that acquired it completes.
  async release(key: string): Promise<void> {
    await safeRedis('lock release', () => redis.del(`lock:${key}`))
  },
}
