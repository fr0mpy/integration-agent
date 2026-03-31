import { z } from 'zod'

export const MCPToolSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  title: z.string().min(3).max(60),
  description: z.string().min(20).max(300),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(
      z.object({
        type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
        description: z.string().min(5),
        required: z.boolean().optional(),
      }),
    ),
    required: z.array(z.string()),
  }),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  httpPath: z.string().startsWith('/'),
  authRequired: z.boolean(),
})

export const MCPServerConfigSchema = z.object({
  tools: z.array(MCPToolSchema).min(1).max(50),
  baseUrl: z.string().url(),
  authMethod: z.enum(['apiKey', 'bearer', 'basic', 'none']),
  authHeader: z.string().optional(),
})

export type MCPToolDefinition = z.infer<typeof MCPToolSchema>
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>
