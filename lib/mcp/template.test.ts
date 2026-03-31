import { describe, it, expect, vi, beforeAll } from 'vitest'
import type { MCPServerConfig } from './types'

// Mock fs and path since template reads files from disk
vi.mock('fs', () => ({
  readFileSync: vi.fn((filePath: string) => {
    if (String(filePath).includes('route.ts.tmpl')) {
      return `import { createMcpHandler } from 'mcp-handler'\nconst handler = createMcpHandler((server) => {\n  // TOOLS_PLACEHOLDER\n})\nexport { handler as GET, handler as POST }`
    }
    return ''
  }),
}))

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>()
  return { ...actual, join: (...args: string[]) => args.join('/') }
})

describe('generateServerSource', () => {
  it('replaces TOOLS_PLACEHOLDER with server.tool() registrations', async () => {
    const { generateServerSource } = await import('./template')

    const config: MCPServerConfig = {
      tools: [
        {
          name: 'list_customers',
          title: 'List Customers',
          description: 'Lists all customers. Call when you need to retrieve customer records.',
          inputSchema: {
            type: 'object',
            properties: {
              email: { type: 'string', description: 'Filter by email' },
              limit: { type: 'number', description: 'Max results' },
            },
            required: ['email'],
          },
          httpMethod: 'GET',
          httpPath: '/customers',
          authRequired: true,
        },
      ],
      baseUrl: 'https://api.stripe.com',
      authMethod: 'bearer',
      authHeader: 'Authorization',
    }

    const source = generateServerSource(config)

    // Placeholder should be replaced
    expect(source).not.toContain('// TOOLS_PLACEHOLDER')

    // Tool registration should be present
    expect(source).toContain("server.tool(")
    expect(source).toContain('"list_customers"')
    expect(source).toContain('Lists all customers')

    // Schema should have email as required (no .optional())
    expect(source).toContain('z.string()')
    // limit should be optional
    expect(source).toContain('.optional()')

    // GET with query params
    expect(source).toContain('URLSearchParams')
  })

  it('generates path param substitution for parameterised paths', async () => {
    const { generateServerSource } = await import('./template')

    const config: MCPServerConfig = {
      tools: [
        {
          name: 'get_customer',
          title: 'Get Customer',
          description: 'Gets a customer by ID. Call when you need a specific customer record.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Customer ID' },
            },
            required: ['id'],
          },
          httpMethod: 'GET',
          httpPath: '/customers/{id}',
          authRequired: false,
        },
      ],
      baseUrl: 'https://api.stripe.com',
      authMethod: 'none',
    }

    const source = generateServerSource(config)
    // Path param should be interpolated, not sent as query param
    expect(source).toContain('${params.id}')
    expect(source).not.toContain("_params.set('id'")
  })

  it('generates JSON body for POST tools', async () => {
    const { generateServerSource } = await import('./template')

    const config: MCPServerConfig = {
      tools: [
        {
          name: 'create_customer',
          title: 'Create Customer',
          description: 'Creates a new customer. Call when registering a new user for payments.',
          inputSchema: {
            type: 'object',
            properties: {
              email: { type: 'string', description: 'Customer email' },
              name: { type: 'string', description: 'Customer name' },
            },
            required: ['email'],
          },
          httpMethod: 'POST',
          httpPath: '/customers',
          authRequired: true,
        },
      ],
      baseUrl: 'https://api.stripe.com',
      authMethod: 'bearer',
      authHeader: 'Authorization',
    }

    const source = generateServerSource(config)
    expect(source).toContain('JSON.stringify')
    expect(source).toContain("'Content-Type': 'application/json'")
  })
})
