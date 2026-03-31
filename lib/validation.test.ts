import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateAndFetchSpec, ValidationError } from './validation'

const mockLookup = vi.fn()

vi.mock('dns/promises', () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(body: Record<string, unknown>, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLookup.mockResolvedValue({ address: '93.184.216.34' })
})

describe('validateAndFetchSpec', () => {
  it('returns parsed spec for valid OpenAPI URL', async () => {
    const spec = { openapi: '3.0.0', info: { title: 'Test' } }
    mockFetch.mockResolvedValueOnce(jsonResponse(spec))

    const result = await validateAndFetchSpec('https://example.com/openapi.json')

    expect(result).toEqual(spec)
  })

  it('rejects non-http protocol', async () => {
    await expect(validateAndFetchSpec('ftp://example.com/spec')).rejects.toThrow(ValidationError)
    await expect(validateAndFetchSpec('file:///etc/passwd')).rejects.toThrow(ValidationError)
  })

  it('rejects javascript: protocol', async () => {
    await expect(validateAndFetchSpec('javascript:alert(1)')).rejects.toThrow()
  })

  it('rejects private IP (192.168.x.x)', async () => {
    mockLookup.mockResolvedValueOnce({ address: '192.168.1.1' })

    await expect(validateAndFetchSpec('https://internal.local/api')).rejects.toThrow(
      'private/internal'
    )
  })

  it('rejects metadata IP (169.254.x.x)', async () => {
    mockLookup.mockResolvedValueOnce({ address: '169.254.169.254' })

    await expect(validateAndFetchSpec('https://metadata/latest')).rejects.toThrow(ValidationError)
  })

  it('rejects loopback (127.x.x.x)', async () => {
    mockLookup.mockResolvedValueOnce({ address: '127.0.0.1' })

    await expect(validateAndFetchSpec('https://loopback/api')).rejects.toThrow(ValidationError)
  })

  it('rejects 10.x.x.x range', async () => {
    mockLookup.mockResolvedValueOnce({ address: '10.0.0.1' })

    await expect(validateAndFetchSpec('https://ten-net/api')).rejects.toThrow(ValidationError)
  })

  it('rejects IPv6 loopback', async () => {
    mockLookup.mockResolvedValueOnce({ address: '::1' })

    await expect(validateAndFetchSpec('https://v6loop/api')).rejects.toThrow(ValidationError)
  })

  it('rejects non-OK HTTP response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Not found', { status: 404 }))

    await expect(validateAndFetchSpec('https://example.com/missing')).rejects.toThrow('404')
  })

  it('rejects oversized content-length', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': '20000000' },
      })
    )

    await expect(validateAndFetchSpec('https://example.com/huge')).rejects.toThrow('too large')
  })

  it('rejects non-OpenAPI JSON', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ name: 'not a spec' }))

    await expect(validateAndFetchSpec('https://example.com/notspec')).rejects.toThrow(
      'does not appear to be an OpenAPI spec'
    )
  })

  it('accepts swagger 2.0 specs', async () => {
    const spec = { swagger: '2.0', info: { title: 'Legacy' } }
    mockFetch.mockResolvedValueOnce(jsonResponse(spec))

    const result = await validateAndFetchSpec('https://example.com/v2.json')

    expect(result).toEqual(spec)
  })

  it('throws on invalid URL format', async () => {
    await expect(validateAndFetchSpec('not-a-url')).rejects.toThrow()
  })

  it('fetches using resolved IP to prevent DNS rebinding', async () => {
    const spec = { openapi: '3.0.0' }
    mockFetch.mockResolvedValueOnce(jsonResponse(spec))

    await validateAndFetchSpec('https://example.com/spec.json')

    const fetchedUrl = mockFetch.mock.calls[0][0]

    expect(fetchedUrl).toContain('93.184.216.34')
    expect(mockFetch.mock.calls[0][1].headers.Host).toBe('example.com')
  })
})
