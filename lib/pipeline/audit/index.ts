import { generateText } from 'ai'
import { z } from 'zod'
import { stepCountIs } from 'ai'
import { chatModel, buildTags } from '../../ai/gateway'
import { prompts, buildSystemPrompt } from '../../prompts'
import { buildAuditPrompt } from '../../prompts/builders/audit'
import type { MCPServerConfig } from '../../mcp/types'
import type { DiscoveryResult } from '../discover'
import type { AuditFinding, AuditSeverity } from '../events'
import { BLOCKED_IP_RANGES } from '../../validation'
import { config as appConfig } from '../../config'

export interface AuditResult {
  passed: boolean
  findings: AuditFinding[]
  summary: { pass: number; warn: number; fail: number }
}

const AI_CHECK_IDS = ['parameter_injection', 'sensitive_data_exposure', 'destructive_operations'] as const

// ── Deterministic checks ────────────────────────────────────────────────────

// Resolves the base URL via DNS and rejects private/loopback IPs to prevent the server acting as an SSRF proxy.
async function checkSsrfBaseUrl(
  config: MCPServerConfig,
  _discovered: DiscoveryResult,
): Promise<AuditFinding> {
  const checkId = 'ssrf_base_url'

  try {
    const url = new URL(config.baseUrl)
    const hostname = url.hostname

    // Check for obvious private hostnames
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
      return finding(checkId, 'fail', 'Base URL points to localhost',
        `The generated server's baseUrl (${config.baseUrl}) points to a local address, which would make it an SSRF proxy.`, [])
    }

    // DNS lookup
    const { lookup } = await import('dns/promises')
    const { address } = await lookup(hostname)
    const isPrivate = address === '::1' || address === '::' || BLOCKED_IP_RANGES.some((r) => r.test(address))

    if (isPrivate) {
      return finding(checkId, 'fail', 'Base URL resolves to private IP',
        `${config.baseUrl} resolves to ${address}, a private/internal address. The generated server would become an SSRF proxy.`, [])
    }

    if (url.protocol !== 'https:') {
      return finding(checkId, 'warn', 'Base URL uses HTTP instead of HTTPS',
        `${config.baseUrl} uses HTTP. API credentials will be transmitted in plaintext.`, [])
    }

    return finding(checkId, 'pass', 'Base URL is safe',
      `${config.baseUrl} resolves to a public IP and uses HTTPS.`, [])
  } catch {
    // DNS failure or invalid URL — warn but don't block (could be temp)
    return finding(checkId, 'warn', 'Could not resolve base URL',
      `DNS lookup for ${config.baseUrl} failed. The target API may be unreachable.`, [])
  }
}

// Compares the generated config's base URL hostname against the spec's; catches AI hallucinations that point elsewhere.
function checkBaseUrlMismatch(
  config: MCPServerConfig,
  discovered: DiscoveryResult,
): AuditFinding {
  const checkId = 'base_url_mismatch'

  if (!discovered.baseUrl) {
    return finding(checkId, 'pass', 'No spec base URL to compare', 'Original spec did not declare a server URL.', [])
  }

  try {
    const configHost = new URL(config.baseUrl).hostname.toLowerCase()
    const specHost = new URL(discovered.baseUrl).hostname.toLowerCase()

    if (configHost === specHost) {
      return finding(checkId, 'pass', 'Base URL matches spec',
        `Generated server targets ${configHost}, matching the OpenAPI spec.`, [])
    }

    // Check if one is a subdomain of the other
    if (configHost.endsWith(`.${specHost}`) || specHost.endsWith(`.${configHost}`)) {
      return finding(checkId, 'warn', 'Base URL is a subdomain variant',
        `Generated baseUrl (${configHost}) differs from spec (${specHost}) but appears to be a subdomain variant.`, [])
    }

    return finding(checkId, 'fail', 'Base URL does not match spec',
      `Generated baseUrl (${configHost}) is a completely different domain from the spec (${specHost}). The AI may have hallucinated a different target.`, [])
  } catch {
    return finding(checkId, 'warn', 'Could not parse URLs for comparison',
      `Unable to compare config baseUrl (${config.baseUrl}) with spec baseUrl (${discovered.baseUrl}).`, [])
  }
}

// Scans every tool's httpPath for .. and percent-encoded traversal sequences that could escape the API root.
function checkPathTraversal(config: MCPServerConfig): AuditFinding {
  const checkId = 'path_traversal'
  const affected: string[] = []

  for (const tool of config.tools) {
    if (/\.\./.test(tool.httpPath) || /%2e%2e/i.test(tool.httpPath) || /%00/.test(tool.httpPath)) {
      affected.push(tool.name)
    }
  }

  if (affected.length > 0) {
    return finding(checkId, 'fail', 'Path traversal detected in tool paths',
      'Tool paths contain directory traversal sequences (..) which could escape the intended API scope.', affected)
  }

  return finding(checkId, 'pass', 'No path traversal patterns found',
    'All tool httpPath values are clean.', [])
}

// Verifies each generated tool maps to a real endpoint in the spec with the correct HTTP method; flags invented paths.
function checkHallucinatedEndpoints(
  config: MCPServerConfig,
  discovered: DiscoveryResult,
): AuditFinding {
  const checkId = 'hallucinated_endpoints'

  // Build set of method:path from discovered spec
  const specEndpoints = new Set(
    discovered.endpoints.map((ep) => `${ep.method}:${ep.path}`),
  )
  const specPaths = new Set(
    discovered.endpoints.map((ep) => ep.path),
  )

  const hallucinated: string[] = []
  const wrongMethod: string[] = []

  for (const tool of config.tools) {
    // Check the primary endpoint
    const key = `${tool.httpMethod}:${tool.httpPath}`

    if (!specEndpoints.has(key)) {
      if (specPaths.has(tool.httpPath)) {
        wrongMethod.push(tool.name)
      } else {
        hallucinated.push(tool.name)
      }
    }

    // Check composed sub-endpoints
    if (tool.composedOf) {
      for (const sub of tool.composedOf) {
        const subKey = `${sub.httpMethod}:${sub.httpPath}`

        if (!specEndpoints.has(subKey)) {
          if (specPaths.has(sub.httpPath)) {
            if (!wrongMethod.includes(tool.name)) wrongMethod.push(tool.name)
          } else {
            if (!hallucinated.includes(tool.name)) hallucinated.push(tool.name)
          }
        }
      }
    }
  }

  if (hallucinated.length > 0) {
    return finding(checkId, 'fail', 'Hallucinated endpoints detected',
      `${hallucinated.length} tool(s) reference API paths not found in the original spec. The AI invented these endpoints.`,
      hallucinated)
  }

  if (wrongMethod.length > 0) {
    return finding(checkId, 'warn', 'HTTP method mismatch',
      `${wrongMethod.length} tool(s) use a different HTTP method than the spec defines for that path.`,
      wrongMethod)
  }

  return finding(checkId, 'pass', 'All tools match spec endpoints',
    'Every generated tool maps to a real endpoint in the OpenAPI spec with the correct HTTP method.', [])
}

// Detects CRLF characters in the auth header name that would allow HTTP request splitting.
function checkAuthHeaderInjection(config: MCPServerConfig): AuditFinding {
  const checkId = 'auth_header_injection'

  if (!config.authHeader) {
    return finding(checkId, 'pass', 'No auth header configured', 'Auth method does not use a custom header.', [])
  }

  if (/[\r\n]/.test(config.authHeader)) {
    return finding(checkId, 'fail', 'CRLF injection in auth header',
      `Auth header "${config.authHeader}" contains newline characters, enabling HTTP header injection.`, [])
  }

  return finding(checkId, 'pass', 'Auth header is safe',
    `Auth header "${config.authHeader}" contains no injection characters.`, [])
}

// Flags POST/PUT/PATCH tools and hard-blocks DELETE tools that have authRequired set to false.
function checkMissingAuthOnWrites(config: MCPServerConfig): AuditFinding {
  const checkId = 'missing_auth_on_writes'
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
  const unauthWrites: string[] = []
  const unauthDeletes: string[] = []

  for (const tool of config.tools) {
    if (writeMethods.has(tool.httpMethod) && !tool.authRequired) {
      unauthWrites.push(tool.name)
      if (tool.httpMethod === 'DELETE') unauthDeletes.push(tool.name)
    }
  }

  if (unauthDeletes.length > 0) {
    return finding(checkId, 'fail', 'DELETE operations without authentication',
      `${unauthDeletes.length} DELETE tool(s) do not require authentication. Unauthenticated delete access is a critical risk.`,
      unauthDeletes)
  }

  if (unauthWrites.length > 0) {
    return finding(checkId, 'warn', 'Write operations without authentication',
      `${unauthWrites.length} write tool(s) (POST/PUT/PATCH) do not require authentication.`,
      unauthWrites)
  }

  return finding(checkId, 'pass', 'All write operations require auth',
    'Every POST/PUT/PATCH/DELETE tool has authRequired set to true.', [])
}

// Flags when generated tool count exceeds spec endpoint count, indicating the AI invented extra tools.
function checkExcessiveScope(
  config: MCPServerConfig,
  discovered: DiscoveryResult,
): AuditFinding {
  const checkId = 'excessive_scope'
  // Composed tools legitimately add tools beyond the endpoint count, so only count non-composed tools
  const nonComposedCount = config.tools.filter((t) => !t.composedOf).length
  const toolCount = nonComposedCount
  const specCount = discovered.endpointCount

  if (toolCount > specCount) {
    return finding(checkId, 'fail', 'More tools than spec endpoints',
      `Generated ${toolCount} individual tools from ${specCount} endpoints. The AI created extra tools not backed by real endpoints.`, [])
  }

  if (specCount > 0 && toolCount / specCount > 0.8) {
    return finding(checkId, 'warn', 'Large API surface exposed',
      `${toolCount} of ${specCount} endpoints exposed (${Math.round(toolCount / specCount * 100)}%). Consider whether all are necessary.`, [])
  }

  return finding(checkId, 'pass', 'Reasonable scope',
    `${toolCount} tools generated from ${specCount} endpoints.`, [])
}

// ── AI-assisted checks ──────────────────────────────────────────────────────

// Calls Sonnet with tool-use to report findings for parameter injection, sensitive data exposure, and destructive operations.
async function runAIAudit(
  config: MCPServerConfig,
  discovered: DiscoveryResult,
  sourceCode: string,
  deterministicResults: AuditFinding[],
): Promise<AuditFinding[]> {
  const userPrompt = buildAuditPrompt(config, discovered, sourceCode, deterministicResults)

  const tags = buildTags(discovered.apiName, 'audit')

  const result = await generateText({
    model: chatModel(),
    temperature: appConfig.ai.audit.temperature,
    maxOutputTokens: appConfig.ai.audit.maxOutputTokens,
    messages: [
      {
        role: 'user',
        content: [{
          type: 'text',
          text: buildSystemPrompt(prompts.audit),
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        }],
      },
      { role: 'assistant', content: prompts.audit.snippets!.assistantAck },
      { role: 'user', content: userPrompt },
    ],
    tools: {
      report_finding: {
        description: 'Report a security finding for one check category',
        inputSchema: z.object({
          checkId: z.enum(['parameter_injection', 'sensitive_data_exposure', 'destructive_operations']),
          severity: z.enum(['pass', 'warn', 'fail']),
          title: z.string().max(100),
          description: z.string().max(500),
          tools: z.array(z.string()).describe('Affected tool names, empty if config-level'),
        }),
      },
    },
    stopWhen: stepCountIs(5),
    providerOptions: {
      anthropic: { thinking: { type: 'enabled', budgetTokens: 5000 } },
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'audit',
      metadata: { tags },
    },
  })

  // Extract tool call results
  const findings: AuditFinding[] = []
  const reported = new Set<string>()

  for (const step of result.steps) {
    for (const tc of step.toolCalls) {
      if (tc.toolName === 'report_finding') {
        const input = tc.input as { checkId: string; severity: AuditSeverity; title: string; description: string; tools: string[] }
        const checkId = input.checkId
        const severity = input.severity
        const title = input.title
        const desc = input.description
        const tools = input.tools

        if (!reported.has(checkId)) {
          reported.add(checkId)
          findings.push({ checkId, severity, title, description: desc, tools })
        }
      }
    }
  }

  // Fill in any missing checks as pass
  for (const checkId of AI_CHECK_IDS) {
    if (!reported.has(checkId)) {
      findings.push(finding(checkId, 'pass', `${checkId} — no issues found`,
        'AI audit did not identify issues for this category.', []))
    }
  }

  return findings
}

// ── Main entry ──────────────────────────────────────────────────────────────

// Orchestrates all deterministic checks then the AI audit; aggregates results into a pass/warn/fail summary.
export async function performSecurityAudit(
  config: MCPServerConfig,
  discovered: DiscoveryResult,
  sourceCode: string,
): Promise<AuditResult> {
  // Phase 1: Deterministic checks
  const deterministic: AuditFinding[] = [
    await checkSsrfBaseUrl(config, discovered),
    checkBaseUrlMismatch(config, discovered),
    checkPathTraversal(config),
    checkHallucinatedEndpoints(config, discovered),
    checkAuthHeaderInjection(config),
    checkMissingAuthOnWrites(config),
    checkExcessiveScope(config, discovered),
  ]

  // Phase 2: AI-assisted checks
  let aiFindings: AuditFinding[]

  try {
    aiFindings = await runAIAudit(config, discovered, sourceCode, deterministic)
  } catch (err) {
    console.error('AI audit failed, using pass-through:', err instanceof Error ? err.message : 'unknown')
    // If AI fails, don't block deploy — report as warnings
    aiFindings = AI_CHECK_IDS.map((checkId) =>
      finding(checkId, 'warn', `${checkId} — AI audit unavailable`,
        'Could not run AI security analysis. Manual review recommended before production use.', []),
    )
  }

  const findings = [...deterministic, ...aiFindings]

  const summary = { pass: 0, warn: 0, fail: 0 }

  for (const f of findings) {
    summary[f.severity]++
  }

  return {
    passed: summary.fail === 0,
    findings,
    summary,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Constructs an AuditFinding record; used by every check function as a concise return helper.
function finding(
  checkId: string,
  severity: AuditSeverity,
  title: string,
  description: string,
  tools: string[],
): AuditFinding {
  return { checkId, severity, title, description, tools }
}
