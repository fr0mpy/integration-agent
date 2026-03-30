import { Redis } from '@upstash/redis'

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

export async function getCachedConfig(specHash: string) {
  const cached = await redis.get<string>(`cache:${specHash}`)
  if (!cached) return null
  return JSON.parse(cached)
}

export async function setCachedConfig(specHash: string, config: unknown) {
  await redis.set(`cache:${specHash}`, JSON.stringify(config), {
    ex: CACHE_TTL_SECONDS,
  })
}
