import { describe, it, expect } from 'vitest'
import { validateConfig } from './validate'
import type { MCPServerConfig } from '../mcp/types'
import type { DiscoveryResult } from './discover'

const baseTool = {
  name: 'list_users',
  title: 'List Users',
  description: 'Lists all users in the system. Call when you need to retrieve user records.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: { type: 'number' as const, description: 'Max results to return' },
    },
    required: [],
  },
  httpMethod: 'GET' as const,
  httpPath: '/users',
  authRequired: true,
}

const baseConfig: MCPServerConfig = {
  tools: [baseTool],
  baseUrl: 'https://api.example.com',
  authMethod: 'bearer',
  authHeader: 'Authorization',
}

const baseDiscovery: Partial<DiscoveryResult> = {
  endpoints: [
    { method: 'GET', path: '/users', operationId: 'listUsers', summary: 'List users', description: '', parameters: [], requestBody: null, responses: {} },
    { method: 'POST', path: '/users', operationId: 'createUser', summary: 'Create user', description: '', parameters: [], requestBody: null, responses: {} },
  ],
}

function makeDiscovery(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    apiName: 'Test API',
    apiDescription: '',
    baseUrl: 'https://api.example.com',
    authMethod: 'bearer',
    authHeader: 'Authorization',
    endpointCount: 2,
    groups: {},
    warnings: [],
    endpoints: baseDiscovery.endpoints!,
    ...overrides,
  }
}

describe('validateConfig', () => {
  it('passes a valid config', () => {
    const result = validateConfig(baseConfig, makeDiscovery())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.toolCount).toBe(1)
  })

  it('catches duplicate tool names', () => {
    const config: MCPServerConfig = {
      ...baseConfig,
      tools: [baseTool, { ...baseTool, httpMethod: 'POST' as const }],
    }
    const result = validateConfig(config, makeDiscovery())
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('Duplicate tool name'))).toBe(true)
  })

  it('catches httpPath not in spec', () => {
    const config: MCPServerConfig = {
      ...baseConfig,
      tools: [{ ...baseTool, httpPath: '/not-in-spec' }],
    }
    const result = validateConfig(config, makeDiscovery())
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('not found in spec'))).toBe(true)
  })

  it('catches required param not in properties', () => {
    const config: MCPServerConfig = {
      ...baseConfig,
      tools: [
        {
          ...baseTool,
          inputSchema: {
            type: 'object',
            properties: { limit: { type: 'number', description: 'Max results' } },
            required: ['limit', 'missing_param'],
          },
        },
      ],
    }
    const result = validateConfig(config, makeDiscovery())
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('missing_param'))).toBe(true)
  })

  it('catches auth-required tool with no authHeader', () => {
    const config: MCPServerConfig = {
      ...baseConfig,
      authHeader: undefined,
      tools: [{ ...baseTool, authRequired: true }],
    }
    const result = validateConfig(config, makeDiscovery())
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('authHeader'))).toBe(true)
  })

  it('allows auth-required: false tools even without authHeader', () => {
    const config: MCPServerConfig = {
      ...baseConfig,
      authMethod: 'none',
      authHeader: undefined,
      tools: [{ ...baseTool, authRequired: false }],
    }
    const result = validateConfig(config, makeDiscovery())
    expect(result.valid).toBe(true)
  })

  it('passes a valid composed tool', () => {
    const config: MCPServerConfig = {
      ...baseConfig,
      tools: [
        {
          ...baseTool,
          name: 'get_user_full',
          composedOf: [
            { httpMethod: 'GET', httpPath: '/users', paramMapping: {} },
            { httpMethod: 'POST', httpPath: '/users', paramMapping: {} },
          ],
        },
      ],
    }
    const result = validateConfig(config, makeDiscovery())
    expect(result.valid).toBe(true)
  })

  it('catches composed sub-endpoint not in spec', () => {
    const config: MCPServerConfig = {
      ...baseConfig,
      tools: [
        {
          ...baseTool,
          name: 'get_user_full',
          composedOf: [
            { httpMethod: 'GET', httpPath: '/users', paramMapping: {} },
            { httpMethod: 'GET', httpPath: '/users/{id}/roles', paramMapping: { userId: 'id' } },
          ],
        },
      ],
    }
    const result = validateConfig(config, makeDiscovery())
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('/users/{id}/roles'))).toBe(true)
  })

  it('catches composed paramMapping referencing unknown input param', () => {
    const config: MCPServerConfig = {
      ...baseConfig,
      tools: [
        {
          ...baseTool,
          name: 'get_user_full',
          composedOf: [
            { httpMethod: 'GET', httpPath: '/users', paramMapping: { nonExistentParam: 'id' } },
            { httpMethod: 'POST', httpPath: '/users', paramMapping: {} },
          ],
        },
      ],
    }
    const result = validateConfig(config, makeDiscovery())
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('nonExistentParam'))).toBe(true)
  })
})
