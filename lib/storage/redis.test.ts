import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}))

describe('redis storage', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  async function loadRedis() {
    return import('./redis')
  }

  it('returns cached value on cache hit', async () => {
    const { redis, getCachedConfig } = await loadRedis()
    const mockData = { endpoints: ['/users'] }
    vi.mocked(redis.get).mockResolvedValueOnce(mockData)

    const result = await getCachedConfig('abc123')
    expect(result).toEqual(mockData)
    expect(redis.get).toHaveBeenCalledWith('cache:abc123')
  })

  it('returns null on cache miss', async () => {
    const { redis, getCachedConfig } = await loadRedis()
    vi.mocked(redis.get).mockResolvedValueOnce(null)

    const result = await getCachedConfig('missing')
    expect(result).toBeNull()
  })

  it('returns null and logs on Redis failure', async () => {
    const { redis, getCachedConfig } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.get).mockRejectedValueOnce(new Error('connection refused'))

    const result = await getCachedConfig('fail')
    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Redis cache read failed:', expect.any(Error))
    warnSpy.mockRestore()
  })

  it('setCachedConfig swallows errors', async () => {
    const { redis, setCachedConfig } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.set).mockRejectedValueOnce(new Error('write failed'))

    await expect(setCachedConfig('key', { data: true })).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith('Redis cache write failed:', expect.any(Error))
    warnSpy.mockRestore()
  })

  it('getCachedSpecHash returns hash on hit', async () => {
    const { redis, getCachedSpecHash } = await loadRedis()
    vi.mocked(redis.get).mockResolvedValueOnce('abc123hash')

    const result = await getCachedSpecHash('https://example.com/spec.json')

    expect(result).toBe('abc123hash')
    expect(redis.get).toHaveBeenCalledWith('url:https://example.com/spec.json')
  })

  it('getCachedSpecHash returns null on miss', async () => {
    const { redis, getCachedSpecHash } = await loadRedis()
    vi.mocked(redis.get).mockResolvedValueOnce(null)

    const result = await getCachedSpecHash('https://unknown.com/spec.json')

    expect(result).toBeNull()
  })

  it('getCachedSpecHash swallows errors', async () => {
    const { redis, getCachedSpecHash } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.get).mockRejectedValueOnce(new Error('timeout'))

    const result = await getCachedSpecHash('https://fail.com/spec.json')

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Redis URL cache read failed:', expect.any(Error))
    warnSpy.mockRestore()
  })

  it('setCachedSpecHash swallows errors', async () => {
    const { redis, setCachedSpecHash } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.set).mockRejectedValueOnce(new Error('write failed'))

    await expect(setCachedSpecHash('https://fail.com/spec.json', 'hash')).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith('Redis URL cache write failed:', expect.any(Error))
    warnSpy.mockRestore()
  })
})
