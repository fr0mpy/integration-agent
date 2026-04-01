import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BundleResult } from '../mcp/bundle'
import type { MCPServerConfig } from '../mcp/types'

const mockStop = vi.fn().mockResolvedValue(undefined)
const mockWriteFiles = vi.fn().mockResolvedValue(undefined)
const mockRunCommand = vi.fn()
const mockDomain = vi.fn().mockReturnValue('https://sandbox-abc123.vercel-sandbox.com')

const mockSandbox = {
  stop: mockStop,
  writeFiles: mockWriteFiles,
  runCommand: mockRunCommand,
  domain: mockDomain,
}

vi.mock('@vercel/sandbox', () => ({
  Sandbox: {
    create: vi.fn().mockResolvedValue(mockSandbox),
  },
}))

const mockConnect = vi.fn().mockResolvedValue(undefined)
const mockListTools = vi.fn()
const mockClose = vi.fn().mockResolvedValue(undefined)

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    close: mockClose,
  })),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(),
}))

const bundle: BundleResult = {
  files: [{ file: 'app/[transport]/route.ts', data: 'export const handler = ...' }],
  sourceCode: 'export const handler = ...',
}

const config: MCPServerConfig = {
  tools: [
    {
      name: 'list_customers',
      title: 'List Customers',
      description: 'Lists customers. Call when retrieving customer records.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      httpMethod: 'GET',
      httpPath: '/customers',
      authRequired: false,
    },
  ],
  baseUrl: 'https://api.stripe.com',
  authMethod: 'none',
}

function makeFinished(exitCode: number) {
  return { exitCode, stdout: vi.fn().mockResolvedValue(''), stderr: vi.fn().mockResolvedValue('') }
}

describe('runSandboxCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStop.mockResolvedValue(undefined)
    mockWriteFiles.mockResolvedValue(undefined)
    mockDomain.mockReturnValue('https://sandbox-abc123.vercel-sandbox.com')
  })

  it('returns ok when build passes and tools match', async () => {
    mockRunCommand
      .mockResolvedValueOnce(makeFinished(0)) // npm install
      .mockResolvedValueOnce(makeFinished(0)) // npm run build
      .mockResolvedValueOnce(undefined)       // npm start (detached, no await on result)

    mockListTools.mockResolvedValue({ tools: [{ name: 'list_customers' }] })

    const { runSandboxCheck } = await import('./sandbox-check')
    const result = await runSandboxCheck(bundle, config)

    expect(result.ok).toBe(true)
    expect(result.verifiedTools).toEqual(['list_customers'])
    // Sandbox stays alive on success (for chat panel use), so stop() is NOT called
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('returns failed when npm install fails', async () => {
    mockRunCommand.mockResolvedValueOnce(makeFinished(1)) // npm install fails

    const { runSandboxCheck } = await import('./sandbox-check')
    const result = await runSandboxCheck(bundle, config)

    expect(result.ok).toBe(false)
    expect(mockStop).toHaveBeenCalled()
  })

  it('returns failed when next build fails', async () => {
    mockRunCommand
      .mockResolvedValueOnce(makeFinished(0)) // npm install ok
      .mockResolvedValueOnce(makeFinished(1)) // next build fails

    const { runSandboxCheck } = await import('./sandbox-check')
    const result = await runSandboxCheck(bundle, config)

    expect(result.ok).toBe(false)
    expect(mockStop).toHaveBeenCalled()
  })

  it('returns failed when live tools do not match', async () => {
    mockRunCommand
      .mockResolvedValueOnce(makeFinished(0))
      .mockResolvedValueOnce(makeFinished(0))
      .mockResolvedValueOnce(undefined)

    // Server returns a different tool name
    mockListTools.mockResolvedValue({ tools: [{ name: 'wrong_tool_name' }] })

    const { runSandboxCheck } = await import('./sandbox-check')
    const result = await runSandboxCheck(bundle, config)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('list_customers')
    expect(mockStop).toHaveBeenCalled()
  })

  it('does not call stop when error thrown before failed flag is set', async () => {
    mockWriteFiles.mockRejectedValueOnce(new Error('disk full'))

    const { runSandboxCheck } = await import('./sandbox-check')
    await expect(runSandboxCheck(bundle, config)).rejects.toThrow('disk full')
    // Error occurs before `failed` is set to true, so stop() is not called
    // (sandbox cleanup relies on the sandbox TTL in this edge case)
    expect(mockStop).not.toHaveBeenCalled()
  })
})
