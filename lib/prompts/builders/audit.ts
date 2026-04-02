import type { MCPServerConfig } from '../../mcp/types'
import type { DiscoveryResult } from '../../pipeline/discover'
import type { AuditFinding } from '../../pipeline/events'

export function buildAuditPrompt(
  config: MCPServerConfig,
  discovered: DiscoveryResult,
  sourceCode: string,
  deterministicResults: AuditFinding[],
): string {
  const lines: string[] = [
    '## MCPServerConfig',
    '',
    `Base URL: ${config.baseUrl}`,
    `Auth method: ${config.authMethod}`,
    config.authHeader ? `Auth header: ${config.authHeader}` : '',
    `Tool count: ${config.tools.length}`,
    '',
    '### Tools',
    '',
  ]

  for (const tool of config.tools) {
    lines.push(`**${tool.name}** — ${tool.httpMethod} ${tool.httpPath} (auth: ${tool.authRequired})`)
    lines.push(`  ${tool.description}`)
    const params = Object.entries(tool.inputSchema.properties)

    if (params.length > 0) {
      lines.push('  Input:')
      const required = new Set(tool.inputSchema.required)

      for (const [name, prop] of params) {
        lines.push(`    - ${name} [${prop.type}]${required.has(name) ? ' (required)' : ''}: ${prop.description}`)
      }
    }

    lines.push('')
  }

  lines.push('## Original API Discovery', '')
  lines.push(`API: ${discovered.apiName}`)
  lines.push(`Base URL: ${discovered.baseUrl}`)
  lines.push(`Endpoint count: ${discovered.endpointCount}`)
  lines.push('')
  lines.push('### Spec Endpoints')
  lines.push('')

  for (const ep of discovered.endpoints) {
    const paramList = ep.parameters.map((p) => `${p.name}[${p.type}] in ${p.in}`).join(', ')
    lines.push(`${ep.method} ${ep.path}${paramList ? ` — params: ${paramList}` : ''}`)

    if (ep.requestBody?.schema) {
      const bodyProps = Object.keys(ep.requestBody.schema.properties).join(', ')
      lines.push(`  body: ${bodyProps}`)
    }
  }

  lines.push('')
  lines.push('## Deterministic Check Results')
  lines.push('')

  for (const f of deterministicResults) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.checkId}: ${f.title}`)
    if (f.description) lines.push(`  ${f.description}`)
  }

  lines.push('')
  lines.push('## Generated Server Source Code')
  lines.push('')
  lines.push('```typescript')
  lines.push(sourceCode)
  lines.push('```')

  return lines.filter((l) => l !== undefined).join('\n')
}
