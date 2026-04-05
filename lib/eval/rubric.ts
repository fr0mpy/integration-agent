import type { MCPServerConfig } from '../mcp/types'
import type { EvalFixture } from './fixtures'

/**
 * Deterministic rubric for scoring synthesis output.
 * Each scorer checks one quality dimension and returns pass/warn/fail.
 * 7 dimensions: hallucination, coverage, auth, schema, naming, tool definitions, security.
 */

export type Score = 'pass' | 'warn' | 'fail'

export interface ScoreResult {
  dimension: string
  label: string
  score: Score
  detail: string
}

export interface EvalResult {
  fixture: string
  scores: ScoreResult[]
  overall: Score
  toolCount: number
  durationMs: number
}

// ── 1. Hallucination ────────────────────────────────────────────────────────

// Checks that every generated tool maps to a real spec endpoint; fails if any tool references an endpoint not in the discovery result.
function scoreHallucination(config: MCPServerConfig, fixture: EvalFixture): ScoreResult {
  const specEndpoints = new Set(
    fixture.discovery.endpoints.map((ep) => `${ep.method}:${ep.path}`),
  )

  const hallucinated: string[] = []

  for (const tool of config.tools) {
    const key = `${tool.httpMethod}:${tool.httpPath}`

    if (!specEndpoints.has(key)) {
      // Check composed sub-endpoints
      if (tool.composedOf) {
        for (const sub of tool.composedOf) {
          const subKey = `${sub.httpMethod}:${sub.httpPath}`

          if (!specEndpoints.has(subKey) && !hallucinated.includes(tool.name)) {
            hallucinated.push(tool.name)
          }
        }
      } else {
        hallucinated.push(tool.name)
      }
    }
  }

  if (hallucinated.length === 0) {
    return {
      dimension: 'hallucination',
      label: 'Hallucination',
      score: 'pass',
      detail: 'All tools map to real spec endpoints',
    }
  }

  return {
    dimension: 'hallucination',
    label: 'Hallucination',
    score: 'fail',
    detail: `${hallucinated.length} tool(s) reference endpoints not in spec: ${hallucinated.join(', ')}`,
  }
}

// ── 2. Coverage ─────────────────────────────────────────────────────────────

// Measures what percentage of spec paths are covered by generated tools; warns below 70%, fails below that threshold.
function scoreCoverage(config: MCPServerConfig, fixture: EvalFixture): ScoreResult {
  const specPaths = new Set(fixture.discovery.endpoints.map((ep) => ep.path))

  const toolPaths = new Set<string>()

  for (const tool of config.tools) {
    toolPaths.add(tool.httpPath)

    if (tool.composedOf) {
      for (const sub of tool.composedOf) {
        toolPaths.add(sub.httpPath)
      }
    }
  }

  const covered = [...specPaths].filter((p) => toolPaths.has(p)).length
  const pct = specPaths.size > 0 ? Math.round((covered / specPaths.size) * 100) : 100

  if (pct === 100) {
    return {
      dimension: 'coverage',
      label: 'Coverage',
      score: 'pass',
      detail: `${covered}/${specPaths.size} spec paths covered (100%)`,
    }
  }

  return {
    dimension: 'coverage',
    label: 'Coverage',
    score: pct >= 70 ? 'warn' : 'fail',
    detail: `${covered}/${specPaths.size} spec paths covered (${pct}%)`,
  }
}

// ── 3. Auth fidelity ────────────────────────────────────────────────────────

// Verifies the synthesised auth method and base URL match the fixture's expected values; wrong auth means the server can't authenticate.
function scoreAuthFidelity(config: MCPServerConfig, fixture: EvalFixture): ScoreResult {
  const issues: string[] = []

  if (config.authMethod !== fixture.expected.expectedAuth) {
    issues.push(`auth: expected ${fixture.expected.expectedAuth}, got ${config.authMethod}`)
  }

  if (config.baseUrl !== fixture.expected.expectedBaseUrl) {
    issues.push(`baseUrl: expected ${fixture.expected.expectedBaseUrl}, got ${config.baseUrl}`)
  }

  if (issues.length === 0) {
    return {
      dimension: 'auth',
      label: 'Auth Fidelity',
      score: 'pass',
      detail: `Correct auth (${config.authMethod}) and baseUrl`,
    }
  }

  return {
    dimension: 'auth',
    label: 'Auth Fidelity',
    score: 'fail',
    detail: issues.join('; '),
  }
}

// ── 4. Schema quality ───────────────────────────────────────────────────────

// Checks that required path parameters from the spec are present in each tool's inputSchema; missing params cause runtime errors.
function scoreSchemaQuality(config: MCPServerConfig, fixture: EvalFixture): ScoreResult {
  const missing: string[] = []

  for (const ep of fixture.discovery.endpoints) {
    const pathParams = ep.parameters.filter((p) => p.in === 'path' && p.required)
    if (pathParams.length === 0) continue

    // Find matching tool(s)
    const matchingTools = config.tools.filter((t) => t.httpPath === ep.path)

    for (const tool of matchingTools) {
      for (const param of pathParams) {
        const hasParam = tool.inputSchema.required.includes(param.name)
        const hasProperty = param.name in tool.inputSchema.properties

        if (!hasParam || !hasProperty) {
          missing.push(`${tool.name} missing required path param "${param.name}"`)
        }
      }
    }
  }

  if (missing.length === 0) {
    return {
      dimension: 'schema',
      label: 'Schema Quality',
      score: 'pass',
      detail: 'All required path params present in tool schemas',
    }
  }

  return {
    dimension: 'schema',
    label: 'Schema Quality',
    score: missing.length <= 2 ? 'warn' : 'fail',
    detail: missing.slice(0, 3).join('; '),
  }
}

// ── 5. Naming ───────────────────────────────────────────────────────────────

// Flags tools with names that are too short or generic; good names are critical for LLMs to select the right tool.
function scoreNaming(config: MCPServerConfig): ScoreResult {
  const bad: string[] = []
  const generic = new Set(['tool', 'tool1', 'tool2', 'api', 'endpoint', 'func', 'fn'])

  for (const tool of config.tools) {
    if (tool.name.length <= 3) {
      bad.push(`"${tool.name}" too short`)
    } else if (generic.has(tool.name)) {
      bad.push(`"${tool.name}" is generic`)
    }
  }

  if (bad.length === 0) {
    return {
      dimension: 'naming',
      label: 'Naming',
      score: 'pass',
      detail: `All ${config.tools.length} tool names are descriptive`,
    }
  }

  return {
    dimension: 'naming',
    label: 'Naming',
    score: 'warn',
    detail: bad.join('; '),
  }
}

// ── 6. Tool Definition Quality ─────────────────────────────────────────────

// Checks that tool descriptions, titles, and property descriptions are substantive
// and distinct — these are the fields a downstream LLM relies on to select the right
// tool and fill in the right arguments.
function scoreToolDefinitions(config: MCPServerConfig): ScoreResult {
  const issues: string[] = []

  // Duplicate titles
  const titles = config.tools.map((t) => t.title.toLowerCase())
  const dupTitles = titles.filter((t, i) => titles.indexOf(t) !== i)

  if (dupTitles.length > 0) {
    issues.push(`duplicate titles: ${[...new Set(dupTitles)].join(', ')}`)
  }

  // Duplicate descriptions
  const descs = config.tools.map((t) => t.description.toLowerCase())
  const dupDescs = descs.filter((d, i) => descs.indexOf(d) !== i)

  if (dupDescs.length > 0) {
    issues.push(`${dupDescs.length} tool(s) share identical descriptions`)
  }

  for (const tool of config.tools) {
    // Description that just restates the HTTP method + path is low quality
    const pathWords = tool.httpPath.replace(/[/{}_-]/g, ' ').trim().toLowerCase()
    const descLower = tool.description.toLowerCase()

    if (descLower === `${tool.httpMethod.toLowerCase()} ${pathWords}`.trim()) {
      issues.push(`${tool.name}: description just restates endpoint`)
    }

    // Missing property descriptions — every property in inputSchema should have one
    const propNames = Object.keys(tool.inputSchema.properties)
    const missingDescs = propNames.filter(
      (p) => !tool.inputSchema.properties[p].description || tool.inputSchema.properties[p].description.length < 5,
    )

    if (missingDescs.length > 0) {
      issues.push(`${tool.name}: weak/missing param descriptions for ${missingDescs.join(', ')}`)
    }
  }

  if (issues.length === 0) {
    return {
      dimension: 'definitions',
      label: 'Tool Definitions',
      score: 'pass',
      detail: `All ${config.tools.length} tools have distinct, substantive descriptions`,
    }
  }

  return {
    dimension: 'definitions',
    label: 'Tool Definitions',
    score: issues.some((i) => i.includes('duplicate') || i.includes('restates')) ? 'fail' : 'warn',
    detail: issues.slice(0, 3).join('; '),
  }
}

// ── 7. Security (deterministic audit checks) ────────────────────────────────

// Runs deterministic security checks (path traversal, unauthenticated writes, excessive scope) on the synthesised config.
function scoreSecurity(config: MCPServerConfig, fixture: EvalFixture): ScoreResult {
  const issues: string[] = []

  // Path traversal check
  for (const tool of config.tools) {
    if (/\.\./.test(tool.httpPath) || /%2e%2e/i.test(tool.httpPath)) {
      issues.push(`${tool.name}: path traversal in httpPath`)
    }
  }

  // Missing auth on writes
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

  for (const tool of config.tools) {
    if (writeMethods.has(tool.httpMethod) && !tool.authRequired) {
      issues.push(`${tool.name}: ${tool.httpMethod} without auth`)
    }
  }

  // Excessive scope — more non-composed tools than spec endpoints
  const nonComposed = config.tools.filter((t) => !t.composedOf).length

  if (nonComposed > fixture.discovery.endpointCount) {
    issues.push(`${nonComposed} tools from ${fixture.discovery.endpointCount} endpoints (excess)`)
  }

  if (issues.length === 0) {
    return {
      dimension: 'security',
      label: 'Security',
      score: 'pass',
      detail: 'No path traversal, auth on writes, reasonable scope',
    }
  }

  return {
    dimension: 'security',
    label: 'Security',
    score: issues.some((i) => i.includes('path traversal')) ? 'fail' : 'warn',
    detail: issues.slice(0, 3).join('; '),
  }
}

// ── Main scorer ─────────────────────────────────────────────────────────────

// Runs all seven scorers against a fixture and returns an aggregated EvalResult; the overall score is fail if any scorer fails.
export function scoreFixture(
  config: MCPServerConfig,
  fixture: EvalFixture,
  durationMs: number,
): EvalResult {
  const scores = [
    scoreHallucination(config, fixture),
    scoreCoverage(config, fixture),
    scoreAuthFidelity(config, fixture),
    scoreSchemaQuality(config, fixture),
    scoreNaming(config),
    scoreToolDefinitions(config),
    scoreSecurity(config, fixture),
  ]

  const hasFail = scores.some((s) => s.score === 'fail')
  const hasWarn = scores.some((s) => s.score === 'warn')

  return {
    fixture: fixture.name,
    scores,
    overall: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    toolCount: config.tools.length,
    durationMs,
  }
}
