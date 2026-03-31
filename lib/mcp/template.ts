import { readFileSync } from 'fs'
import { join } from 'path'
import type { MCPServerConfig, MCPToolDefinition } from './types'

const TMPL_DIR = join(process.cwd(), 'generated-server-template')

/**
 * Generates the full route.ts source for an MCP server from a validated config.
 * Reads the route.ts.tmpl template and replaces TOOLS_PLACEHOLDER with
 * generated server.tool() registrations.
 */
export function generateServerSource(config: MCPServerConfig): string {
  const tmpl = readFileSync(join(TMPL_DIR, 'app/[transport]/route.ts.tmpl'), 'utf-8')
  const tools = config.tools.map(generateToolRegistration).join('\n\n')
  return tmpl.replace('// TOOLS_PLACEHOLDER', tools)
}

function generateToolRegistration(tool: MCPToolDefinition): string {
  const schema = generateZodSchema(tool)
  const handler = generateHandler(tool)
  return [
    `  server.tool(`,
    `    ${JSON.stringify(tool.name)},`,
    `    ${JSON.stringify(tool.description)},`,
    `    {`,
    schema,
    `    },`,
    `    async (params, { authInfo }) => {`,
    handler,
    `    },`,
    `  )`,
  ].join('\n')
}

function generateZodSchema(tool: MCPToolDefinition): string {
  const required = new Set(tool.inputSchema.required)
  const lines: string[] = []

  for (const [name, prop] of Object.entries(tool.inputSchema.properties)) {
    const base = zodType(prop.type)
    const withDesc = `${base}.describe(${JSON.stringify(prop.description)})`
    const final = required.has(name) ? withDesc : `${withDesc}.optional()`
    lines.push(`      ${name}: ${final},`)
  }

  return lines.join('\n')
}

function zodType(type: string): string {
  switch (type) {
    case 'number': return 'z.number()'
    case 'boolean': return 'z.boolean()'
    case 'array': return 'z.array(z.unknown())'
    case 'object': return 'z.record(z.unknown())'
    default: return 'z.string()'
  }
}

function generateHandler(tool: MCPToolDefinition): string {
  const { httpMethod, httpPath, authRequired } = tool
  const paramNames = Object.keys(tool.inputSchema.properties)
  const required = new Set(tool.inputSchema.required)

  // Detect path params: /users/{id} → ['id']
  const pathParams = (httpPath.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))
  const queryParams = paramNames.filter(
    (n) => !pathParams.includes(n) && (httpMethod === 'GET' || httpMethod === 'DELETE'),
  )
  const bodyParams = paramNames.filter(
    (n) =>
      !pathParams.includes(n) &&
      (httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'PATCH'),
  )

  const lines: string[] = []

  // Credential lookup
  if (authRequired) {
    lines.push(`      const creds = await fetchCredentials(authInfo?.token)`)
  }

  // Build URL with path param substitution
  let urlExpr = `\`\${BASE_URL}${httpPath.replace(/\{([^}]+)\}/g, '${params.$1}')}\``

  if (queryParams.length > 0) {
    lines.push(`      const _params = new URLSearchParams()`)
    for (const p of queryParams) {
      if (required.has(p)) {
        lines.push(`      _params.set(${JSON.stringify(p)}, String(params.${p}))`)
      } else {
        lines.push(`      if (params.${p} !== undefined) _params.set(${JSON.stringify(p)}, String(params.${p}))`)
      }
    }
    urlExpr = `\`\${BASE_URL}${httpPath.replace(/\{([^}]+)\}/g, '${params.$1}')}?\${_params.toString()}\``
  }

  lines.push(`      const url = ${urlExpr}`)

  // Build fetch options
  const fetchOpts: string[] = [`method: ${JSON.stringify(httpMethod)}`]

  if (authRequired) {
    const authHeaderExpr = `'Authorization': \`Bearer \${creds.apiKey}\``
    fetchOpts.push(`headers: { ${authHeaderExpr} }`)
  }

  if (bodyParams.length > 0) {
    const bodyObj = bodyParams
      .map((p) => (required.has(p) ? `${p}: params.${p}` : `...(params.${p} !== undefined && { ${p}: params.${p} })`))
      .join(', ')
    lines.push(`      const body = JSON.stringify({ ${bodyObj} })`)
    if (authRequired) {
      fetchOpts.push(`headers: { 'Authorization': \`Bearer \${creds.apiKey}\`, 'Content-Type': 'application/json' }`)
      // remove the plain auth header we added above
      fetchOpts.splice(fetchOpts.findIndex((l) => l.startsWith('headers:')), 1)
      fetchOpts.push(`headers: { 'Authorization': \`Bearer \${creds.apiKey}\`, 'Content-Type': 'application/json' }`)
    } else {
      fetchOpts.push(`headers: { 'Content-Type': 'application/json' }`)
    }
    fetchOpts.push(`body`)
  }

  lines.push(`      const res = await fetch(url, { ${fetchOpts.join(', ')} })`)
  lines.push(`      const data = await res.json()`)
  lines.push(`      return { content: [{ type: 'text', text: JSON.stringify(data) }] }`)

  return lines.join('\n')
}
