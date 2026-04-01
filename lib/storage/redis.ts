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

async function safeRedis<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    console.warn(`Redis ${label} failed:`, err instanceof Error ? err.message : 'unknown')
    return null
  }
}

function hashUrl(specUrl: string): string {
  return createHash('sha256').update(specUrl).digest('hex')
}

export const urlCache = {
  getHash(specUrl: string) {
    return safeRedis('URL cache read', () => redis.get<string>(`url:${hashUrl(specUrl)}`))
  },

  setHash(specUrl: string, specHash: string) {
    return safeRedis('URL cache write', () =>
      redis.set(`url:${hashUrl(specUrl)}`, specHash, { ex: CACHE_TTL_SECONDS }),
    )
  },
}

export const configCache = {
  get(specHash: string) {
    return safeRedis('config read', () => redis.get(`cache:${specHash}`))
  },

  set(specHash: string, config: unknown) {
    return safeRedis('config write', () =>
      redis.set(`cache:${specHash}`, config, { ex: CACHE_TTL_SECONDS }),
    )
  },
}

export const discoveryCache = {
  get(specHash: string) {
    return safeRedis('discovery read', () => redis.get(`discovery:${specHash}`))
  },

  set(specHash: string, discovery: unknown) {
    return safeRedis('discovery write', () =>
      redis.set(`discovery:${specHash}`, discovery, { ex: CACHE_TTL_SECONDS }),
    )
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

  async release(key: string): Promise<void> {
    await safeRedis('lock release', () => redis.del(`lock:${key}`))
  },
}

export const specCache = {
  get(specHash: string) {
    return safeRedis('spec read', () =>
      redis.get<Record<string, unknown>>(`spec:${specHash}`),
    )
  },

  set(specHash: string, spec: Record<string, unknown>) {
    return safeRedis('spec write', () =>
      redis.set(`spec:${specHash}`, spec, { ex: CACHE_TTL_SECONDS }),
    )
  },
}
