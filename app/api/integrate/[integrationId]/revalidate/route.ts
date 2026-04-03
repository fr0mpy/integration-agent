// Live credential validation — decrypts the user's API key, calls up to 3 tools via the sandbox, and sniffs HTTP status
import { getIntegration, getCredentials, updateIntegration } from '@/lib/storage/neon'
import { mcpConfigCache } from '@/lib/storage/redis'
import { decrypt } from '@/lib/crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { isValidUUID, validateSandboxUrl, ValidationError } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'
import type { MCPServerConfig } from '@/lib/mcp/types'

export const maxDuration = 60

export interface RevalidateResult {
  toolName: string
  ok: boolean
  /** HTTP status from the upstream API (if available in the response body) */
  status?: number
  /** First 200 chars of the response */
  preview: string
}

export interface RevalidateResponse {
  ok: boolean
  liveValidatedAt: string
  results: RevalidateResult[]
  error?: string
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  const { integrationId } = await params

  if (!isValidUUID(integrationId)) {
    return errors.badRequest('Invalid integration ID.')
  }

  const integration = await getIntegration(integrationId)

  if (!integration) {
    return errors.notFound('Integration not found.')
  }

  const sandboxUrl = integration.sandbox_url as string | null

  if (!sandboxUrl) {
    return errors.badRequest('No sandbox URL — run the pipeline first.')
  }

  // SSRF guard
  try {
    await validateSandboxUrl(sandboxUrl)
  } catch (err) {
    return errors.badRequest(err instanceof ValidationError ? err.message : 'Invalid sandbox URL.')
  }

  // Try Redis first, fall back to Postgres (Redis writes unreliable inside WDK steps)
  let config = await mcpConfigCache.get(integration.spec_hash) as MCPServerConfig | null
  if (!config && integration.config_json) config = integration.config_json as MCPServerConfig

  if (!config) {
    return errors.notFound('Config not cached — pipeline may need to re-run.')
  }

  const encryptedValue = await getCredentials(integrationId)

  if (!encryptedValue) {
    return errors.badRequest('No credentials saved — enter an API credential first.')
  }

  let apiKey: string

  try {
    const parsed = JSON.parse(decrypt(encryptedValue)) as { apiKey: string }
    apiKey = parsed.apiKey
  } catch {
    return errors.internal()
  }

  // Pick up to 3 representative tools — prefer safe GETs with few required params to minimise side effects
  const candidates = config.tools
    .filter((t) => t.authRequired)
    .sort((a, b) => {
      const methodScore = (m: string) => ({ GET: 0, DELETE: 1, POST: 2, PUT: 3, PATCH: 4 }[m] ?? 5)
      const requiredScore = (t: typeof a) => t.inputSchema.required.length
      return methodScore(a.httpMethod) - methodScore(b.httpMethod) || requiredScore(a) - requiredScore(b)
    })
    .slice(0, 3)

  if (candidates.length === 0) {
    // API has no auth-required tools — credentials aren't needed, mark as verified anyway
    const liveValidatedAt = new Date().toISOString()
    await updateIntegration(integrationId, { live_validated_at: liveValidatedAt })
    return success({
      ok: true,
      liveValidatedAt,
      results: [],
      note: 'No auth-required tools — this API does not need credentials',
    })
  }

  // Connect to sandbox MCP server with credential as Bearer token.
  // The generated server's fetchCredentials() falls back to authInfo?.token when
  // CREDENTIAL_ENDPOINT is not set, so the Bearer value is used as the API key.
  const client = new Client({ name: 'integration-agent-revalidator', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(
    new URL(`${sandboxUrl}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } },
  )

  try {
    await client.connect(transport)
  } catch (err) {
    console.error('Sandbox connect failed:', err instanceof Error ? err.message : 'unknown')
    return errors.serviceUnavailable('Sandbox unreachable — VM may have expired.')
  }

  // Call each candidate tool with placeholder args and inspect the HTTP status to verify the credential works
  const results: RevalidateResult[] = []

  try {
    for (const tool of candidates) {
      // Build minimal args — only required params, with placeholder values
      const args: Record<string, unknown> = {}

      for (const name of tool.inputSchema.required) {
        const prop = tool.inputSchema.properties[name]
        if (!prop) continue

        switch (prop.type) {
          case 'number': args[name] = 0; break
          case 'boolean': args[name] = false; break
          default: args[name] = 'test'
        }
      }

      try {
        const result = await client.callTool({ name: tool.name, arguments: args })
        const contentArr = result.content as Array<{ type: string; text?: string }>
        const raw = contentArr?.[0]
        const text = raw && 'text' in raw ? String(raw.text) : JSON.stringify(result.content)

        // Sniff HTTP status from the API response JSON if present
        let status: number | undefined

        try {
          const parsed = JSON.parse(text) as Record<string, unknown>
          if (typeof parsed.status === 'number') status = parsed.status
          if (typeof parsed.statusCode === 'number') status = parsed.statusCode
        } catch { /* not JSON */ }

        const ok = !result.isError && (status === undefined || status < 400)
        // Redact response body — expose only the HTTP status code
        results.push({ toolName: tool.name, ok, status, preview: status ? `HTTP ${status}` : (ok ? 'OK' : 'Error') })
      } catch (err) {
        results.push({
          toolName: tool.name,
          ok: false,
          preview: err instanceof Error ? err.message : 'Tool call failed',
        })
      }
    }
  } finally {
    await client.close().catch((err: unknown) => console.warn('MCP client close failed:', err instanceof Error ? err.message : 'unknown'))
  }

  // If any tool returned a non-error status, the credential is valid — persist the timestamp
  const anyOk = results.some((r) => r.ok)
  const liveValidatedAt = new Date().toISOString()

  if (anyOk) {
    await updateIntegration(integrationId, { live_validated_at: liveValidatedAt })
  }

  return success({
    ok: anyOk,
    liveValidatedAt: anyOk ? liveValidatedAt : '',
    results,
  })
}
