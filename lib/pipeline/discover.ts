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

import { z } from 'zod'
import { generateText, Output } from 'ai'
import { synthesisModel, buildTags } from '../ai/gateway'

const MAX_ENDPOINTS = 50
const MIN_SUMMARY_LENGTH = 10

const EnrichmentSchema = z.object({
  selectedEndpoints: z.array(z.object({
    path: z.string(),
    method: z.string(),
    operationId: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/),
    summary: z.string().min(10).max(120),
  })),
})

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

  const prompt = [
    `API: ${result.apiName}`,
    `Total endpoints: ${result.endpointCount}`,
    '',
    'Endpoints:',
    JSON.stringify(endpointList, null, 2),
    '',
    'Instructions:',
    tooMany
      ? `Select the ${MAX_ENDPOINTS} most useful endpoints for an LLM tool-caller. Prioritise CRUD operations, common queries, and high-value actions. Exclude admin, bulk, and rarely-used endpoints.`
      : 'Return all endpoints.',
    'For every endpoint:',
    '- If operationId is null, generate a clean camelCase name from the method and path (e.g. GET /users/{id} → getUserById).',
    '- If the summary is shorter than 10 characters or empty, write a clear one-line summary describing what the endpoint does.',
    '- Keep existing operationIds and summaries that are already good.',
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

    const groups: Record<string, DiscoveredEndpoint[]> = {}

    for (const ep of enrichedEndpoints) {
      const segment = ep.path.split('/').filter(Boolean)[0] ?? '_root'
      if (!groups[segment]) groups[segment] = []
      groups[segment].push(ep)
    }

    return {
      ...result,
      endpoints: enrichedEndpoints,
      endpointCount: enrichedEndpoints.length,
      groups,
    }
  } catch (err) {
    result.warnings.push(`Enrichment failed: ${err instanceof Error ? err.message : 'unknown'} — using raw discovery`)
    return result
  }
}

/**
 * Stage 1a — Discovery. Pure TypeScript, no LLM call.
 * Dereferences $ref pointers, then extracts the API surface.
 */
export async function discoverEndpoints(spec: Record<string, unknown>): Promise<DiscoveryResult> {
  const warnings: string[] = []

  let resolved = spec

  try {
    const $RefParser = await import('@apidevtools/json-schema-ref-parser')
    resolved = await $RefParser.default.dereference(
      structuredClone(spec),
      { dereference: { circular: 'ignore' } },
    ) as Record<string, unknown>
  } catch (err) {
    warnings.push(`$ref dereferencing failed: ${err instanceof Error ? err.message : 'unknown error'}`)
  }

  const info = (resolved.info ?? {}) as Record<string, unknown>
  const apiName = String(info.title ?? 'Untitled API')
  const apiDescription = String(info.description ?? '')

  const baseUrl = extractBaseUrl(resolved)
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

  const groups: Record<string, DiscoveredEndpoint[]> = {}
  for (const ep of endpoints) {
    const segment = ep.path.split('/').filter(Boolean)[0] ?? '_root'
    if (!groups[segment]) groups[segment] = []
    groups[segment].push(ep)
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
    groups,
    warnings,
  }
}

function extractBaseUrl(spec: Record<string, unknown>): string {
  // OpenAPI 3.x
  const servers = spec.servers as Array<{ url?: string }> | undefined
  if (servers?.[0]?.url) return servers[0].url

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

const MAX_SCHEMA_DEPTH = 2

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

function extractResponses(operation: Record<string, unknown>): Record<string, string> {
  const responses = (operation.responses ?? {}) as Record<string, Record<string, unknown>>
  const result: Record<string, string> = {}

  for (const [code, resp] of Object.entries(responses)) {
    result[code] = String(resp.description ?? '')
  }

  return result
}
