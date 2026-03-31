import { Redis } from '@upstash/redis'

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const CACHE_KEY_PREFIX = 'cache:'
const URL_HASH_PREFIX = 'url:'
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

export async function getCachedSpecHash(specUrl: string) {
  try {
    return await redis.get<string>(`${URL_HASH_PREFIX}${specUrl}`)
  } catch (err) {
    console.warn('Redis URL cache read failed:', err)
    return null
  }
}

export async function setCachedSpecHash(specUrl: string, specHash: string) {
  try {
    await redis.set(`${URL_HASH_PREFIX}${specUrl}`, specHash, {
      ex: CACHE_TTL_SECONDS,
    })
  } catch (err) {
    console.warn('Redis URL cache write failed:', err)
  }
}

export async function getCachedConfig(specHash: string) {
  try {
    return await redis.get(`${CACHE_KEY_PREFIX}${specHash}`)
  } catch (err) {
    console.warn('Redis cache read failed:', err)
    return null
  }
}

export async function setCachedConfig(specHash: string, config: unknown) {
  try {
    await redis.set(`${CACHE_KEY_PREFIX}${specHash}`, config, {
      ex: CACHE_TTL_SECONDS,
    })
  } catch (err) {
    console.warn('Redis cache write failed:', err)
  }
}
