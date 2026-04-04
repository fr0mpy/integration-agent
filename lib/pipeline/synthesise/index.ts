import { generateText, Output } from 'ai'
import { synthesisModel, buildTags } from '../../ai/gateway'
import { prompts, buildSystemPrompt } from '../../prompts'
import { buildSynthesisPrompt } from '../../prompts/builders/synthesis'
import { MCPSynthesisOutputSchema, MCPServerConfigSchema, type MCPSynthesisOutput, type MCPToolDefinition, type MCPServerConfig } from '../../mcp/types'
import { config } from '../../config'
import type { DiscoveryResult, DiscoveredEndpoint } from '../discover'

const MAX_RETRIES = config.pipeline.synthesisMaxRetries

/**
 * Stage 2 — Synthesis.
 * Converts discovered endpoints into MCP tool definitions using
 * generateText + Output.object() via AI Gateway.
 *
 * The LLM outputs only what it uniquely knows: names, descriptions, and
 * endpoint references by index. All structural fields (httpPath, httpMethod,
 * param names/types, baseUrl, authMethod, authHeader) are injected from the
 * spec — the LLM never controls them.
 */
export async function synthesiseTools(
  discovered: DiscoveryResult,
  buildErrors?: string,
): Promise<MCPServerConfig> {
  // Build the prompt from discovered endpoints — append sandbox build errors if this is a retry
  let userPrompt = buildSynthesisPrompt(discovered)

  if (buildErrors) {
    userPrompt += `\n\nPREVIOUS SANDBOX BUILD ERRORS — fix these in the generated tool handlers:\n${buildErrors}`
  }

  let lastError: string | null = null

  const safeName = discovered.apiName.replace(/[\x00-\x1F\x7F]/g, '')
  console.log(`[Synthesis] Starting for "${safeName}" (${discovered.endpointCount} endpoints)`)

  // Retry loop — on failure, feed the error back into the prompt so the model can self-correct
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const prompt = lastError
      ? `${userPrompt}\n\nPrevious attempt failed validation with these errors:\n${lastError}\n\nPlease fix the issues and try again.`
      : userPrompt

    const tags = buildTags(discovered.apiName, 'synthesis', attempt > 0 ? `retry-${attempt}` : undefined)
    console.log(`[Synthesis] Attempt ${attempt + 1}/${MAX_RETRIES + 1} for "${safeName}"`, { tags })

    try {
      // Call Haiku via AI Gateway — Output.object validates against Zod schema at runtime
      const { output } = await generateText({
        model: synthesisModel(),
        system: buildSystemPrompt(prompts.synthesis),
        prompt,
        output: Output.object({ schema: MCPSynthesisOutputSchema }),
        temperature: config.ai.synthesis.temperature,
        maxOutputTokens: config.ai.synthesis.maxOutputTokens,
        providerOptions: {
          gateway: { tags },
        },
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'synthesis',
          metadata: { tags },
        },
      })

      // Schema validated but model returned nothing parseable — retry with error context
      if (!output) {
        lastError = 'Model returned no structured output'
        console.warn(`[Synthesis] Attempt ${attempt + 1}/${MAX_RETRIES + 1}: null output`)
        continue
      }

      // Map LLM's index-based output back to discovered endpoints — inject structural fields from spec
      const tools = assembleMCPTools(output, discovered)

      // All tools dropped means the LLM's endpoint indexes didn't match — retry
      if (tools.length === 0) {
        lastError = 'All tools were dropped — endpoint indexes did not match discovered endpoints'
        console.warn(`[Synthesis] Attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${lastError}`)
        continue
      }

      console.log(`[Synthesis] Success on attempt ${attempt + 1} — ${tools.length} tools assembled`)

      // All structural fields injected from the spec — LLM never controls these
      return MCPServerConfigSchema.parse({
        tools,
        baseUrl: discovered.baseUrl,
        authMethod: discovered.authMethod,
        authHeader: discovered.authHeader ?? undefined,
      })
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Unknown error during synthesis'
      console.warn(`[Synthesis] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, lastError)

      if (err instanceof Error && err.cause) {
        console.warn('[Synthesis] Cause:', err.cause)
      }
    }
  }

  console.error(`[Synthesis] All ${MAX_RETRIES + 1} attempts exhausted for "${discovered.apiName}"`)
  throw new Error(
    `Synthesis failed after ${MAX_RETRIES + 1} attempts. Last error: ${lastError}`,
  )
}

// ── Assembly ──────────────────────────────────────────────────────────────────

type PropType = 'string' | 'number' | 'boolean' | 'array' | 'object'

// Coerce OpenAPI types to JSON Schema subset — 'integer' → 'number', unknowns → 'string'
function normalizeType(t: string): PropType {
  if (t === 'integer') return 'number'
  if (['string', 'number', 'boolean', 'array', 'object'].includes(t)) return t as PropType
  return 'string'
}

// Build the tool's input schema from spec params + request body — LLM only provides descriptions
function buildInputSchema(
  ep: DiscoveredEndpoint,
  propertyDescriptions: Record<string, string>,
): MCPToolDefinition['inputSchema'] {
  const properties: Record<string, { type: PropType; description: string }> = {}
  const required: string[] = []

  for (const p of ep.parameters) {
    if (p.in === 'path' || p.in === 'query') {
      properties[p.name] = {
        type: normalizeType(p.type),
        description: propertyDescriptions[p.name] || p.description || `The ${p.name} value`,
      }
      if (p.required) required.push(p.name)
    }
  }

  if (ep.requestBody?.schema) {
    const bodyRequired = new Set(ep.requestBody.schema.required)

    for (const [name, prop] of Object.entries(ep.requestBody.schema.properties)) {
      properties[name] = {
        type: normalizeType(prop.type),
        description: propertyDescriptions[name] || prop.description || `The ${name} value`,
      }
      if (bodyRequired.has(name)) required.push(name)
    }
  }

  return { type: 'object', properties, required }
}

// Merge params from multiple endpoints into a single schema for composed (multi-step) tools
function buildComposedInputSchema(
  endpoints: DiscoveredEndpoint[],
  propertyDescriptions: Record<string, string>,
): MCPToolDefinition['inputSchema'] {
  const properties: Record<string, { type: PropType; description: string }> = {}
  const required: string[] = []
  const seen = new Set<string>()

  for (const ep of endpoints) {
    for (const p of ep.parameters) {
      if ((p.in === 'path' || p.in === 'query') && !seen.has(p.name)) {
        seen.add(p.name)
        properties[p.name] = {
          type: normalizeType(p.type),
          description: propertyDescriptions[p.name] || p.description || `The ${p.name} value`,
        }
        if (p.required) required.push(p.name)
      }
    }
  }

  return { type: 'object', properties, required }
}

/**
 * Assembles final MCPToolDefinition[] from the LLM's index-based output.
 * All structural fields (httpMethod, httpPath, param names/types) come from
 * discovered.endpoints — the LLM's output is used only for naming, descriptions,
 * and endpoint selection.
 */
function assembleMCPTools(
  output: MCPSynthesisOutput,
  discovered: DiscoveryResult,
): MCPToolDefinition[] {
  const tools: MCPToolDefinition[] = []

  for (const item of output.tools) {
    const ep = discovered.endpoints[item.endpointIndex]

    if (!ep) {
      console.warn(`[Synthesis] Dropping tool "${item.name}" — endpointIndex ${item.endpointIndex} out of bounds (${discovered.endpoints.length} endpoints)`)
      continue
    }

    const method = ep.method.toUpperCase() as MCPToolDefinition['httpMethod']

    if (item.composedOf) {
      const subEndpoints: DiscoveredEndpoint[] = []
      const composedOf: MCPToolDefinition['composedOf'] = []

      for (const idx of item.composedOf) {
        const subEp = discovered.endpoints[idx]

        if (!subEp) {
          console.warn(`[Synthesis] Composed tool "${item.name}" sub-endpoint index ${idx} out of bounds — skipping`)
          continue
        }

        subEndpoints.push(subEp)
        const paramMapping: Record<string, string> = {}

        for (const p of subEp.parameters) {
          if (p.in === 'path' || p.in === 'query') paramMapping[p.name] = p.name
        }

        composedOf.push({
          httpMethod: subEp.method.toUpperCase() as MCPToolDefinition['httpMethod'],
          httpPath: subEp.path,
          paramMapping,
        })
      }

      if (composedOf.length < 2) {
        // Not enough valid sub-endpoints — fall back to simple tool
        console.warn(`[Synthesis] Composed tool "${item.name}" fell back to simple tool (< 2 valid sub-endpoints)`)
        tools.push({
          name: item.name,
          title: item.title,
          description: item.description,
          inputSchema: buildInputSchema(ep, item.propertyDescriptions),
          httpMethod: method,
          httpPath: ep.path,
          authRequired: item.authRequired,
        })
        continue
      }

      tools.push({
        name: item.name,
        title: item.title,
        description: item.description,
        inputSchema: buildComposedInputSchema(subEndpoints, item.propertyDescriptions),
        httpMethod: method,
        httpPath: ep.path,
        authRequired: item.authRequired,
        composedOf,
      })
    } else {
      tools.push({
        name: item.name,
        title: item.title,
        description: item.description,
        inputSchema: buildInputSchema(ep, item.propertyDescriptions),
        httpMethod: method,
        httpPath: ep.path,
        authRequired: item.authRequired,
      })
    }
  }

  return tools
}
