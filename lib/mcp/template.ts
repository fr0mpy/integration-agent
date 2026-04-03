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

// Renders a single server.tool(...) call for one MCP tool, combining its name, description, Zod schema, and HTTP handler body.
function generateToolRegistration(tool: MCPToolDefinition): string {
  const schema = generateZodSchema(tool)
  const handler = tool.composedOf ? generateComposedHandler(tool) : generateHandler(tool)
  return [
    '  server.tool(',
    `    ${JSON.stringify(tool.name)},`,
    `    ${JSON.stringify(tool.description)},`,
    '    {',
    schema,
    '    },',
    '    async (params, { authInfo }) => {',
    handler,
    '    },',
    '  )',
  ].join('\n')
}

// Converts a tool's inputSchema into Zod property declarations, marking optional fields and attaching descriptions.
function generateZodSchema(tool: MCPToolDefinition): string {
  const SAFE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
  const required = new Set(tool.inputSchema.required)
  const lines: string[] = []

  for (const [name, prop] of Object.entries(tool.inputSchema.properties)) {
    if (!SAFE_IDENT.test(name)) {
      throw new Error(`Unsafe inputSchema property name: ${name}`)
    }

    const base = zodType(prop.type)
    const withDesc = `${base}.describe(${JSON.stringify(prop.description)})`
    const final = required.has(name) ? withDesc : `${withDesc}.optional()`
    lines.push(`      ${name}: ${final},`)
  }

  return lines.join('\n')
}

// Maps a JSON Schema type string to the corresponding Zod primitive expression; defaults to z.string() for unknown types.
function zodType(type: string): string {
  switch (type) {
    case 'number': return 'z.number()'
    case 'boolean': return 'z.boolean()'
    case 'array': return 'z.array(z.unknown())'
    case 'object': return 'z.record(z.unknown())'
    default: return 'z.string()'
  }
}

// Emits the async handler body for a single-endpoint tool: builds URL, optional query string or body, fetch call, and JSON response.
function generateHandler(tool: MCPToolDefinition): string {
  const { httpMethod, httpPath, authRequired } = tool
  const paramNames = Object.keys(tool.inputSchema.properties)
  const required = new Set(tool.inputSchema.required)

  // Validate full httpPath to prevent template injection via backticks or ${...}
  const SAFE_PATH = /^[a-zA-Z0-9/_{}.\-]+$/

  if (!SAFE_PATH.test(httpPath)) {
    throw new Error(`Unsafe httpPath: ${httpPath}`)
  }

  // Detect path params: /users/{id} → ['id']
  const pathParams = (httpPath.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))

  // Validate path param names are safe JS identifiers to prevent code injection
  const SAFE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

  for (const p of pathParams) {
    if (!SAFE_IDENT.test(p)) {
      throw new Error(`Unsafe path parameter name: ${p}`)
    }
  }

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
    lines.push('      const creds = await fetchCredentials(authInfo?.token)')
  }

  // Build URL with path param substitution — encodeURIComponent prevents path traversal
  let urlExpr = `\`\${BASE_URL}${httpPath.replace(/\{([^}]+)\}/g, '${encodeURIComponent(String(params.$1))}')}\``

  if (queryParams.length > 0) {
    lines.push('      const _params = new URLSearchParams()')

    for (const p of queryParams) {
      if (required.has(p)) {
        lines.push(`      _params.set(${JSON.stringify(p)}, String(params.${p}))`)
      } else {
        lines.push(`      if (params.${p} !== undefined) _params.set(${JSON.stringify(p)}, String(params.${p}))`)
      }
    }

    urlExpr = `\`\${BASE_URL}${httpPath.replace(/\{([^}]+)\}/g, '${encodeURIComponent(String(params.$1))}')}?\${_params.toString()}\``
  }

  lines.push(`      const url = ${urlExpr}`)

  // Build fetch options
  const fetchOpts: string[] = [`method: ${JSON.stringify(httpMethod)}`]

  if (authRequired) {
    const authHeaderExpr = '\'Authorization\': `Bearer ${creds.apiKey}`'
    fetchOpts.push(`headers: { ${authHeaderExpr} }`)
  }

  if (bodyParams.length > 0) {
    const bodyObj = bodyParams
      .map((p) => (required.has(p) ? `${p}: params.${p}` : `...(params.${p} !== undefined && { ${p}: params.${p} })`))
      .join(', ')
    lines.push(`      const body = JSON.stringify({ ${bodyObj} })`)

    if (authRequired) {
      const idx = fetchOpts.findIndex((l) => l.startsWith('headers:'))
      fetchOpts[idx] = 'headers: { \'Authorization\': `Bearer ${creds.apiKey}`, \'Content-Type\': \'application/json\' }'
    } else {
      fetchOpts.push('headers: { \'Content-Type\': \'application/json\' }')
    }

    fetchOpts.push('body')
  }

  lines.push('      let data: unknown')
  lines.push('      try {')
  lines.push(`        const res = await fetch(url, { ${fetchOpts.join(', ')} })`)
  lines.push('        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)')
  lines.push('        data = await res.json()')
  lines.push('      } catch (err) {')
  lines.push('        return { isError: true, content: [{ type: \'text\', text: err instanceof Error ? err.message : String(err) }] }')
  lines.push('      }')
  lines.push('      return { content: [{ type: \'text\', text: JSON.stringify(data) }] }')

  return lines.join('\n')
}

/**
 * Generates a handler for a composed tool that calls multiple endpoints in parallel
 * via Promise.all and merges the results into a single keyed object.
 */
function generateComposedHandler(tool: MCPToolDefinition): string {
  const { authRequired, composedOf } = tool

  if (!composedOf || composedOf.length < 2) {
    throw new Error(`Composed tool ${tool.name} must have at least 2 sub-endpoints`)
  }

  const SAFE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

  const lines: string[] = []

  if (authRequired) {
    lines.push('      const creds = await fetchCredentials(authInfo?.token)')
  }

  // Build fetch expressions for each sub-endpoint
  const fetchExprs: string[] = []
  const resultKeys: string[] = []

  for (const sub of composedOf) {
    // Validate full httpPath and path param names
    const SAFE_PATH = /^[a-zA-Z0-9/_{}.\-]+$/

    if (!SAFE_PATH.test(sub.httpPath)) {
      throw new Error(`Unsafe httpPath in composed sub-endpoint: ${sub.httpPath}`)
    }

    const pathParams = (sub.httpPath.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1))

    for (const p of pathParams) {
      if (!SAFE_IDENT.test(p)) {
        throw new Error(`Unsafe path parameter name in composed sub-endpoint: ${p}`)
      }
    }

    // Build URL with param mapping: composedOf.paramMapping maps tool param → path param
    const reverseMapping: Record<string, string> = {}

    for (const [toolParam, subParam] of Object.entries(sub.paramMapping)) {
      reverseMapping[subParam] = toolParam
    }

    const urlPath = sub.httpPath.replace(/\{([^}]+)\}/g, (_match, paramName: string) => {
      const toolParam = reverseMapping[paramName] ?? paramName
      return `\${encodeURIComponent(String(params.${toolParam}))}`
    })

    const urlExpr = `\`\${BASE_URL}${urlPath}\``

    const fetchOpts: string[] = [`method: ${JSON.stringify(sub.httpMethod)}`]

    if (authRequired) {
      fetchOpts.push('headers: { \'Authorization\': `Bearer ${creds.apiKey}` }')
    }

    fetchExprs.push(`fetch(${urlExpr}, { ${fetchOpts.join(', ')} }).then(r => r.ok ? r.json() : Promise.reject(new Error(\`HTTP \${r.status} \${r.statusText}\`)))`)

    // Derive a result key from the last meaningful path segment
    const segments = sub.httpPath.split('/').filter(Boolean)
    const lastSegment = segments[segments.length - 1] ?? 'result'
    const key = lastSegment.startsWith('{') ? segments[segments.length - 2] ?? 'result' : lastSegment
    resultKeys.push(key)
  }

  // Deduplicate keys by appending index if needed
  const seen = new Map<string, number>()
  const dedupedKeys = resultKeys.map((key) => {
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    return count > 0 ? `${key}_${count}` : key
  })

  // Fix first occurrence if it has duplicates
  for (const [key, count] of seen) {
    if (count > 1) {
      const idx = dedupedKeys.indexOf(key)
      if (idx !== -1) dedupedKeys[idx] = `${key}_0`
    }
  }

  lines.push('      let merged: unknown')
  lines.push('      try {')
  lines.push(`        const [${dedupedKeys.join(', ')}] = await Promise.all([`)

  for (const expr of fetchExprs) {
    lines.push(`          ${expr},`)
  }

  lines.push('        ])')
  lines.push(`        merged = { ${dedupedKeys.map((k) => `${JSON.stringify(k)}: ${k}`).join(', ')} }`)
  lines.push('      } catch (err) {')
  lines.push('        return { isError: true, content: [{ type: \'text\', text: err instanceof Error ? err.message : String(err) }] }')
  lines.push('      }')
  lines.push('      return { content: [{ type: \'text\', text: JSON.stringify(merged) }] }')

  return lines.join('\n')
}
