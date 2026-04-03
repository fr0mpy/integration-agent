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
  // Reject characters that would escape the template literal in lib/mcp/template.ts
  // and inject arbitrary code into generated servers.
  httpPath: z.string().startsWith('/').refine(
    (p) =>
      !p.includes('`') &&
      !p.includes('${') &&
      !p.includes('\\') &&
      !p.includes('\n') &&
      !p.includes('\r') &&
      !p.includes('\0'),
    'HTTP path must not contain backticks, backslashes, template expressions, newlines, or null bytes.',
  ),
  authRequired: z.boolean(),
  composedOf: z.array(z.object({
    httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    // Same injection guard as the top-level httpPath — prevents code injection
    // into generated template literals via composed sub-endpoint paths.
    httpPath: z.string().startsWith('/').refine(
      (p) =>
        !p.includes('`') &&
        !p.includes('${') &&
        !p.includes('\\') &&
        !p.includes('\n') &&
        !p.includes('\r') &&
        !p.includes('\0'),
      'HTTP path must not contain backticks, backslashes, template expressions, newlines, or null bytes.',
    ),
    paramMapping: z.record(z.string()),
  })).min(2).optional(),
})

// Index-based schema for LLM output.
// The LLM outputs only what it uniquely knows: names, descriptions, endpoint references.
// All structural fields (httpPath, httpMethod, param names/types, auth) are injected
// from the spec after synthesis — the LLM never controls them.
const MCPToolSynthesisItemSchema = z.object({
  endpointIndex: z.number().int().min(0),  // index into discovered.endpoints[]
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
  title: z.string().min(3).max(60),
  description: z.string().min(20).max(300),
  propertyDescriptions: z.record(z.string()),  // LLM-authored descriptions for each param
  authRequired: z.boolean(),
  composedOf: z.array(z.number().int().min(0)).min(2).optional(),  // indexes for composed tools
})

export const MCPSynthesisOutputSchema = z.object({
  tools: z.array(MCPToolSynthesisItemSchema).min(1).max(50),
})

// Full runtime config — all structural fields injected from the spec, never from LLM output
export const MCPServerConfigSchema = z.object({
  tools: z.array(MCPToolSchema).min(1).max(50),
  baseUrl: z.string().url(),
  authMethod: z.enum(['apiKey', 'bearer', 'basic', 'oauth2', 'none']),
  authHeader: z.string().optional(),
})

export type MCPToolDefinition = z.infer<typeof MCPToolSchema>
export type MCPSynthesisOutput = z.infer<typeof MCPSynthesisOutputSchema>
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>
