import { describe, it, expect } from 'vitest'
import { MCPToolSchema, MCPServerConfigSchema } from './types'

describe('MCPToolSchema', () => {
  const validTool = {
    name: 'list_pets',
    title: 'List Pets',
    description: 'Call this to retrieve all pets from the store. Returns an array of pet objects with their IDs, names, and statuses.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'string' as const,
          description: 'Maximum number of pets to return',
        },
      },
      required: [],
    },
    httpMethod: 'GET' as const,
    httpPath: '/pets',
    authRequired: false,
  }

  it('accepts a valid tool definition', () => {
    const result = MCPToolSchema.safeParse(validTool)
    expect(result.success).toBe(true)
  })

  it('rejects tool name with uppercase letters', () => {
    const result = MCPToolSchema.safeParse({ ...validTool, name: 'listPets' })
    expect(result.success).toBe(false)
  })

  it('rejects tool name starting with a number', () => {
    const result = MCPToolSchema.safeParse({ ...validTool, name: '1_pets' })
    expect(result.success).toBe(false)
  })

  it('rejects empty tool name', () => {
    const result = MCPToolSchema.safeParse({ ...validTool, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects description shorter than 20 chars', () => {
    const result = MCPToolSchema.safeParse({ ...validTool, description: 'Too short' })
    expect(result.success).toBe(false)
  })

  it('rejects description longer than 300 chars', () => {
    const result = MCPToolSchema.safeParse({ ...validTool, description: 'x'.repeat(301) })
    expect(result.success).toBe(false)
  })

  it('rejects title shorter than 3 chars', () => {
    const result = MCPToolSchema.safeParse({ ...validTool, title: 'Ab' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid HTTP method', () => {
    const result = MCPToolSchema.safeParse({ ...validTool, httpMethod: 'OPTIONS' })
    expect(result.success).toBe(false)
  })

  it('rejects httpPath not starting with /', () => {
    const result = MCPToolSchema.safeParse({ ...validTool, httpPath: 'pets' })
    expect(result.success).toBe(false)
  })

  it('rejects property description shorter than 5 chars', () => {
    const result = MCPToolSchema.safeParse({
      ...validTool,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID' },
        },
        required: ['id'],
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('MCPServerConfigSchema', () => {
  const validConfig = {
    tools: [
      {
        name: 'list_pets',
        title: 'List Pets',
        description: 'Call this to retrieve all pets from the store. Returns an array of pet objects.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
        httpMethod: 'GET' as const,
        httpPath: '/pets',
        authRequired: false,
      },
    ],
    baseUrl: 'https://petstore.swagger.io/v2',
    authMethod: 'apiKey' as const,
    authHeader: 'api_key',
  }

  it('accepts a valid server config', () => {
    const result = MCPServerConfigSchema.safeParse(validConfig)
    expect(result.success).toBe(true)
  })

  it('rejects config with no tools', () => {
    const result = MCPServerConfigSchema.safeParse({ ...validConfig, tools: [] })
    expect(result.success).toBe(false)
  })

  it('rejects config with more than 50 tools', () => {
    const tools = Array.from({ length: 51 }, (_, i) => ({
      ...validConfig.tools[0],
      name: `tool_${i}`,
    }))
    const result = MCPServerConfigSchema.safeParse({ ...validConfig, tools })
    expect(result.success).toBe(false)
  })

  it('rejects invalid baseUrl', () => {
    const result = MCPServerConfigSchema.safeParse({ ...validConfig, baseUrl: 'not-a-url' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid authMethod', () => {
    const result = MCPServerConfigSchema.safeParse({ ...validConfig, authMethod: 'token-exchange' })
    expect(result.success).toBe(false)
  })

  it('allows optional authHeader', () => {
    const { authHeader, ...withoutHeader } = validConfig
    const result = MCPServerConfigSchema.safeParse(withoutHeader)
    expect(result.success).toBe(true)
  })
})
