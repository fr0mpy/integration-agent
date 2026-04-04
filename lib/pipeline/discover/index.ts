import { z } from 'zod'
import { generateText, Output } from 'ai'
import { synthesisModel, buildTags } from '../../ai/gateway'
import { prompts, interpolate } from '../../prompts'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiscoveredEndpoint {
  method: string
  path: string
  operationId: string | null
  summary: string
  description: string
  parameters: ParameterInfo[]
  requestBody: RequestBodyInfo | null
  responses: Record<string, string>
}

export interface ParameterInfo {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  required: boolean
  description: string
  type: string
}

export interface PropertyInfo {
  type: string
  description: string
  nullable: boolean
  items: PropertyInfo | null
  properties: Record<string, PropertyInfo> | null
}

export interface SchemaInfo {
  type: string
  properties: Record<string, PropertyInfo>
  required: string[]
}

export interface RequestBodyInfo {
  required: boolean
  contentType: string
  description: string
  schema: SchemaInfo | null
}

export interface DiscoveryResult {
  apiName: string
  apiDescription: string
  baseUrl: string
  authMethod: 'apiKey' | 'bearer' | 'basic' | 'oauth2' | 'none'
  authHeader: string | null
  endpointCount: number
  endpoints: DiscoveredEndpoint[]
  groups: Record<string, DiscoveredEndpoint[]>
  warnings: string[]
}

// ── Spec parsing helpers ──────────────────────────────────────────────────────

// Buckets endpoints by their first path segment (e.g. /pets → 'pets'); keeps enrichment prompts focused per resource.
function groupEndpoints(endpoints: DiscoveredEndpoint[]): Record<string, DiscoveredEndpoint[]> {
  const groups: Record<string, DiscoveredEndpoint[]> = {}

  for (const ep of endpoints) {
    const segment = ep.path.split('/').filter(Boolean)[0] ?? '_root'
    if (!groups[segment]) groups[segment] = []
    groups[segment].push(ep)
  }

  return groups
}

// ── AI Enrichment (Stage 1b) ──────────────────────────────────────────────────

import { config } from '../../config'

const MAX_ENDPOINTS = config.discovery.maxEndpoints
const MIN_SUMMARY_LENGTH = config.discovery.minSummaryLength

const EnrichmentSchema = z.object({
  selectedEndpoints: z.array(z.object({
    path: z.string(),
    method: z.string(),
    operationId: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/),
    summary: z.string().min(10).max(120),
  })),
})

// Returns true when the spec needs AI enrichment: more than 50 endpoints, missing operationIds, or vague summaries.
export function needsEnrichment(result: DiscoveryResult): boolean {
  if (result.endpointCount > MAX_ENDPOINTS) return true
  if (result.endpoints.some((e) => e.operationId === null)) return true
  if (result.endpoints.some((e) => e.summary.length < MIN_SUMMARY_LENGTH)) return true
  return false
}

/**
 * Stage 1b — Enrichment. Optional Haiku call via AI Gateway.
 * Only fires when the spec has >50 endpoints, missing operationIds, or vague summaries.
 */
export async function enrichDiscovery(
  result: DiscoveryResult,
): Promise<DiscoveryResult> {
  if (!needsEnrichment(result)) return result

  const tooMany = result.endpointCount > MAX_ENDPOINTS
  const endpointList = result.endpoints.map((e) => ({
    path: e.path,
    method: e.method,
    operationId: e.operationId,
    summary: e.summary,
  }))

  const snippets = prompts.enrichment.snippets!
  const header = interpolate(snippets.header, {
    apiName: result.apiName,
    endpointCount: String(result.endpointCount),
  })
  const instruction = tooMany
    ? interpolate(snippets.selectInstruction, { maxEndpoints: String(MAX_ENDPOINTS) })
    : snippets.returnAllInstruction

  const prompt = [
    header,
    '',
    'Endpoints:',
    JSON.stringify(endpointList, null, 2),
    '',
    'Instructions:',
    instruction,
    snippets.enrichRules,
  ].join('\n')

  try {
    const { experimental_output: output } = await generateText({
      model: synthesisModel(),
      output: Output.object({ schema: EnrichmentSchema }),
      prompt,
      providerOptions: {
        gateway: { tags: buildTags(result.apiName, 'discover') },
      },
    })

    if (!output) {
      result.warnings.push('Enrichment returned no output — using raw discovery')
      return result
    }

    const selected = output.selectedEndpoints
    const selectedKeys = new Set(selected.map((s) => `${s.method.toUpperCase()}:${s.path}`))

    const enrichedEndpoints = result.endpoints
      .filter((e) => selectedKeys.has(`${e.method}:${e.path}`))
      .map((e) => {
        const match = selected.find(
          (s) => s.method.toUpperCase() === e.method && s.path === e.path,
        )

        if (match) {
          return {
            ...e,
            operationId: match.operationId,
            summary: match.summary,
          }
        }

        return e
      })

    const droppedCount = result.endpointCount - enrichedEndpoints.length

    if (droppedCount > 0) {
      result.warnings.push(`Enrichment selected ${enrichedEndpoints.length} of ${result.endpointCount} endpoints (dropped ${droppedCount})`)
    }

    return {
      ...result,
      endpoints: enrichedEndpoints,
      endpointCount: enrichedEndpoints.length,
      groups: groupEndpoints(enrichedEndpoints),
    }
  } catch (err) {
    console.error('Enrichment failed:', err instanceof Error ? err.message : 'unknown')
    result.warnings.push('Enrichment failed — using raw discovery results')
    return result
  }
}

// ── Discovery (Stage 1a) ──────────────────────────────────────────────────────

/**
 * Stage 1a — Discovery. Pure TypeScript, no LLM call.
 * Dereferences $ref pointers, then extracts the API surface.
 */
export async function discoverEndpoints(spec: Record<string, unknown>, specUrl?: string): Promise<DiscoveryResult> {
  const warnings: string[] = []

  let resolved = spec

  try {
    const $RefParser = await import('@apidevtools/json-schema-ref-parser')
    resolved = await $RefParser.default.dereference(
      structuredClone(spec),
      { dereference: { circular: 'ignore' } },
    ) as Record<string, unknown>
  } catch (err) {
    console.error('$ref dereferencing failed:', err instanceof Error ? err.message : 'unknown')
    warnings.push('$ref resolution failed — some schema references may be unresolved')
  }

  const info = (resolved.info ?? {}) as Record<string, unknown>
  const apiName = String(info.title ?? 'Untitled API')
  const apiDescription = String(info.description ?? '')

  const baseUrl = extractBaseUrl(resolved, specUrl)
  const { authMethod, authHeader } = extractAuth(resolved)

  const endpoints: DiscoveredEndpoint[] = []
  let deprecatedCount = 0
  const paths = (resolved.paths ?? {}) as Record<string, Record<string, unknown>>

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue

    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method] as Record<string, unknown> | undefined
      if (!operation) continue

      if (operation.deprecated === true) {
        deprecatedCount++
        continue
      }

      endpoints.push({
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId ? String(operation.operationId) : null,
        summary: String(operation.summary ?? ''),
        description: String(operation.description ?? ''),
        parameters: extractParameters(operation, pathItem),
        requestBody: extractRequestBody(operation),
        responses: extractResponses(operation),
      })
    }
  }

  if (deprecatedCount > 0) {
    warnings.push(`Filtered ${deprecatedCount} deprecated endpoint${deprecatedCount > 1 ? 's' : ''}`)
  }

  return {
    apiName,
    apiDescription,
    baseUrl,
    authMethod,
    authHeader,
    endpointCount: endpoints.length,
    endpoints,
    groups: groupEndpoints(endpoints),
    warnings,
  }
}

// Pulls the server URL from OpenAPI 3.x servers[0] or builds it from Swagger 2.x host + basePath.
// Resolves relative server URLs against specUrl (e.g. "/api/v3" → "https://petstore3.swagger.io/api/v3").
function extractBaseUrl(spec: Record<string, unknown>, specUrl?: string): string {
  // OpenAPI 3.x
  const servers = spec.servers as Array<{ url?: string }> | undefined

  if (servers?.[0]?.url) {
    const url = servers[0].url

    if (specUrl && !url.startsWith('http://') && !url.startsWith('https://')) {
      try { return new URL(url, specUrl).href } catch { /* fall through */ }
    }

    return url
  }

  // Swagger 2.x
  const host = spec.host as string | undefined
  const basePath = spec.basePath as string | undefined
  const schemes = spec.schemes as string[] | undefined

  if (host) {
    const scheme = schemes?.[0] ?? 'https'
    return `${scheme}://${host}${basePath ?? ''}`
  }

  return ''
}

// Infers the API's auth scheme and header name from securitySchemes / securityDefinitions; populates the generated config.
function extractAuth(spec: Record<string, unknown>): {
  authMethod: DiscoveryResult['authMethod']
  authHeader: string | null
} {
  // OpenAPI 3.x
  const components = spec.components as Record<string, unknown> | undefined
  const securitySchemes = (components?.securitySchemes ?? {}) as Record<
    string,
    Record<string, unknown>
  >

  // Swagger 2.x fallback
  const swaggerDefs = (spec.securityDefinitions ?? {}) as Record<
    string,
    Record<string, unknown>
  >

  const schemes = { ...swaggerDefs, ...securitySchemes }

  for (const scheme of Object.values(schemes)) {
    const type = String(scheme.type ?? '')
    const schemeValue = String(scheme.scheme ?? '').toLowerCase()

    if (type === 'oauth2') return { authMethod: 'oauth2', authHeader: 'Authorization' }
    if (type === 'http' && schemeValue === 'bearer') return { authMethod: 'bearer', authHeader: 'Authorization' }
    if (type === 'http' && schemeValue === 'basic') return { authMethod: 'basic', authHeader: 'Authorization' }

    if (type === 'apiKey') {
      const inValue = String(scheme.in ?? 'header')
      const name = String(scheme.name ?? 'Authorization')
      return {
        authMethod: 'apiKey',
        authHeader: inValue === 'header' ? name : null,
      }
    }
  }

  return { authMethod: 'none', authHeader: null }
}

// Merges path-level and operation-level parameters, with operation params taking precedence by name+in.
function extractParameters(
  operation: Record<string, unknown>,
  pathItem: Record<string, unknown>,
): ParameterInfo[] {
  const pathParams = (pathItem.parameters ?? []) as Array<Record<string, unknown>>
  const opParams = (operation.parameters ?? []) as Array<Record<string, unknown>>

  // Operation params override path-level params by name+in
  const merged = new Map<string, Record<string, unknown>>()
  for (const p of pathParams) merged.set(`${p.name}:${p.in}`, p)
  for (const p of opParams) merged.set(`${p.name}:${p.in}`, p)

  return Array.from(merged.values()).map((p) => {
    const schema = (p.schema ?? {}) as Record<string, unknown>
    return {
      name: String(p.name ?? ''),
      in: String(p.in ?? 'query') as ParameterInfo['in'],
      required: Boolean(p.required),
      description: String(p.description ?? ''),
      type: String(schema.type ?? p.type ?? 'string'),
    }
  })
}

// Extracts the first content-type's schema from a request body definition; used for POST/PUT tool inputs.
function extractRequestBody(operation: Record<string, unknown>): RequestBodyInfo | null {
  const requestBody = operation.requestBody as Record<string, unknown> | undefined
  if (!requestBody) return null

  const content = (requestBody.content ?? {}) as Record<string, Record<string, unknown>>
  const contentType = Object.keys(content)[0] ?? 'application/json'
  const mediaType = content[contentType] ?? {}
  const rawSchema = mediaType.schema as Record<string, unknown> | undefined

  return {
    required: Boolean(requestBody.required),
    contentType,
    description: String(requestBody.description ?? ''),
    schema: rawSchema ? extractSchemaInfo(rawSchema) : null,
  }
}

const MAX_SCHEMA_DEPTH = config.discovery.maxSchemaDepth

// Flattens a JSON Schema object's properties into a structured SchemaInfo; feeds the synthesis prompt.
function extractSchemaInfo(schema: Record<string, unknown>): SchemaInfo {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = (schema.required ?? []) as string[]

  const extracted: Record<string, PropertyInfo> = {}

  for (const [name, prop] of Object.entries(properties)) {
    extracted[name] = extractPropertyInfo(prop, 0)
  }

  return {
    type: String(schema.type ?? 'object'),
    properties: extracted,
    required,
  }
}

// Recursively maps a single schema property to a typed PropertyInfo, capped at 2 levels to avoid prompt bloat.
function extractPropertyInfo(prop: Record<string, unknown>, depth: number): PropertyInfo {
  const type = String(prop.type ?? 'string')
  const info: PropertyInfo = {
    type,
    description: String(prop.description ?? ''),
    nullable: Boolean(prop.nullable),
    items: null,
    properties: null,
  }

  if (depth >= MAX_SCHEMA_DEPTH) return info

  if (type === 'array' && prop.items) {
    info.items = extractPropertyInfo(
      prop.items as Record<string, unknown>,
      depth + 1,
    )
  }

  if (type === 'object' && prop.properties) {
    const nested = (prop.properties ?? {}) as Record<string, Record<string, unknown>>
    const result: Record<string, PropertyInfo> = {}

    for (const [name, sub] of Object.entries(nested)) {
      result[name] = extractPropertyInfo(sub, depth + 1)
    }

    info.properties = result
  }

  return info
}

// Collects HTTP response codes and descriptions for an operation; included in the synthesis prompt for context.
function extractResponses(operation: Record<string, unknown>): Record<string, string> {
  const responses = (operation.responses ?? {}) as Record<string, Record<string, unknown>>
  const result: Record<string, string> = {}

  for (const [code, resp] of Object.entries(responses)) {
    result[code] = String(resp.description ?? '')
  }

  return result
}
