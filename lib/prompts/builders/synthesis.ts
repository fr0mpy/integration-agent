import type { DiscoveryResult, DiscoveredEndpoint } from '../../pipeline/discover'

// Serialises a DiscoveryResult into the structured text prompt sent to the synthesis LLM to generate MCP tool definitions.
export function buildSynthesisPrompt(discovered: DiscoveryResult): string {
  const lines: string[] = [
    `API: ${discovered.apiName}`,
    `Description: ${discovered.apiDescription || 'No description provided'}`,
    `Auth method: ${discovered.authMethod}`,
    discovered.authHeader ? `Auth header: ${discovered.authHeader}` : '',
    `Endpoint count: ${discovered.endpointCount}`,
    '',
    'Endpoints (reference each by its [index] number in your output):',
    '',
  ]

  discovered.endpoints.forEach((endpoint, i) => {
    lines.push(formatEndpoint(endpoint, i))
    lines.push('')
  })

  return lines.filter((l) => l !== undefined).join('\n')
}

// Formats a single discovered endpoint as a human-readable block; one entry in the synthesis prompt's endpoint list.
function formatEndpoint(ep: DiscoveredEndpoint, index: number): string {
  const parts: string[] = [
    `[${index}] ${ep.method} ${ep.path}`,
    ep.operationId ? `  operationId: ${ep.operationId}` : '',
    ep.summary ? `  summary: ${ep.summary}` : '',
    ep.description ? `  description: ${ep.description}` : '',
  ]

  if (ep.parameters.length > 0) {
    parts.push('  parameters:')

    for (const p of ep.parameters) {
      const req = p.required ? ' (required)' : ''
      parts.push(`    - ${p.name} [${p.type}] in ${p.in}${req}: ${p.description || 'no description'}`)
    }
  }

  if (ep.requestBody) {
    parts.push(`  requestBody: ${ep.requestBody.contentType}${ep.requestBody.required ? ' (required)' : ''}`)

    if (ep.requestBody.schema) {
      const props = ep.requestBody.schema.properties
      const required = new Set(ep.requestBody.schema.required)

      for (const [name, prop] of Object.entries(props)) {
        const req = required.has(name) ? ' (required)' : ''
        parts.push(`    - ${name} [${prop.type}]${req}: ${prop.description || 'no description'}`)
      }
    }
  }

  const successCodes = Object.entries(ep.responses)
    .filter(([code]) => code.startsWith('2'))
    .map(([code, desc]) => `${code}: ${desc}`)

  if (successCodes.length > 0) {
    parts.push(`  responses: ${successCodes.join(', ')}`)
  }

  return parts.filter(Boolean).join('\n')
}
