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

  it('mcpConfigCache.get returns cached value on hit', async () => {
    const { redis, mcpConfigCache } = await loadRedis()
    const mockData = { endpoints: ['/users'] }
    vi.mocked(redis.get).mockResolvedValueOnce(mockData)

    const result = await mcpConfigCache.get('abc123')
    expect(result).toEqual(mockData)
    expect(redis.get).toHaveBeenCalledWith('cache:v2:abc123')
  })

  it('mcpConfigCache.get returns null on miss', async () => {
    const { redis, mcpConfigCache } = await loadRedis()
    vi.mocked(redis.get).mockResolvedValueOnce(null)

    const result = await mcpConfigCache.get('missing')
    expect(result).toBeNull()
  })

  it('mcpConfigCache.get returns null and logs on failure', async () => {
    const { redis, mcpConfigCache } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.get).mockRejectedValueOnce(new Error('connection refused'))

    const result = await mcpConfigCache.get('fail')
    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Redis mcpConfigCache read failed:', 'connection refused')
    warnSpy.mockRestore()
  })

  it('mcpConfigCache.set swallows errors', async () => {
    const { redis, mcpConfigCache } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.set).mockRejectedValueOnce(new Error('write failed'))

    await expect(mcpConfigCache.set('key', { data: true })).resolves.toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Redis mcpConfigCache write failed:', 'write failed')
    warnSpy.mockRestore()
  })

  it('specUrlIndex.getHash returns hash on hit', async () => {
    const { redis, specUrlIndex } = await loadRedis()
    vi.mocked(redis.get).mockResolvedValueOnce('abc123hash')

    const result = await specUrlIndex.getHash('https://example.com/spec.json')

    expect(result).toBe('abc123hash')
    // URL is now hashed before use as Redis key
    expect(redis.get).toHaveBeenCalledWith(expect.stringMatching(/^url:[a-f0-9]{64}$/))
  })

  it('specUrlIndex.getHash returns null on miss', async () => {
    const { redis, specUrlIndex } = await loadRedis()
    vi.mocked(redis.get).mockResolvedValueOnce(null)

    const result = await specUrlIndex.getHash('https://unknown.com/spec.json')

    expect(result).toBeNull()
  })

  it('specUrlIndex.getHash swallows errors', async () => {
    const { redis, specUrlIndex } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.get).mockRejectedValueOnce(new Error('timeout'))

    const result = await specUrlIndex.getHash('https://fail.com/spec.json')

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Redis specUrlIndex read failed:', 'timeout')
    warnSpy.mockRestore()
  })

  it('specUrlIndex.setHash swallows errors', async () => {
    const { redis, specUrlIndex } = await loadRedis()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(redis.set).mockRejectedValueOnce(new Error('write failed'))

    await expect(specUrlIndex.setHash('https://fail.com/spec.json', 'hash')).resolves.toBeNull()
    expect(warnSpy).toHaveBeenCalledWith('Redis specUrlIndex write failed:', 'write failed')
    warnSpy.mockRestore()
  })
})
