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

  it('configCache.get returns cached value on hit', async () => {
    const { redis, configCache } = await loadRedis()
    const mockData = { endpoints: ['/users'] }
    vi.mocked(redis.get).mockResolvedValueOnce(mockData)

    const result = await configCache.get('abc123')
    expect(result).toEqual(mockData)
    expect(redis.get).toHaveBeenCalledWith('cache:abc123')
  })

  it('configCache.get returns null on miss', async () => {
    const { redis, configCache } = await loadRedis()
    vi.mocked(redis.get).mockResolvedValueOnce(null)

    const result = await configCache.get('missing')
    expect(result).toBeNull()
  })

  it('configCache.get returns null and logs on failure', async () => {
    const { redis, configCache } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.get).mockRejectedValueOnce(new Error('connection refused'))

    const result = await configCache.get('fail')
    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Redis config read failed:', 'connection refused')
    warnSpy.mockRestore()
  })

  it('configCache.set swallows errors', async () => {
    const { redis, configCache } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.set).mockRejectedValueOnce(new Error('write failed'))

    await expect(configCache.set('key', { data: true })).resolves.toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Redis config write failed:', 'write failed')
    warnSpy.mockRestore()
  })

  it('urlCache.getHash returns hash on hit', async () => {
    const { redis, urlCache } = await loadRedis()
    vi.mocked(redis.get).mockResolvedValueOnce('abc123hash')

    const result = await urlCache.getHash('https://example.com/spec.json')

    expect(result).toBe('abc123hash')
    expect(redis.get).toHaveBeenCalledWith('url:https://example.com/spec.json')
  })

  it('urlCache.getHash returns null on miss', async () => {
    const { redis, urlCache } = await loadRedis()
    vi.mocked(redis.get).mockResolvedValueOnce(null)

    const result = await urlCache.getHash('https://unknown.com/spec.json')

    expect(result).toBeNull()
  })

  it('urlCache.getHash swallows errors', async () => {
    const { redis, urlCache } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.get).mockRejectedValueOnce(new Error('timeout'))

    const result = await urlCache.getHash('https://fail.com/spec.json')

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Redis URL cache read failed:', 'timeout')
    warnSpy.mockRestore()
  })

  it('urlCache.setHash swallows errors', async () => {
    const { redis, urlCache } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.set).mockRejectedValueOnce(new Error('write failed'))

    await expect(urlCache.setHash('https://fail.com/spec.json', 'hash')).resolves.toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Redis URL cache write failed:', 'write failed')
    warnSpy.mockRestore()
  })
})
