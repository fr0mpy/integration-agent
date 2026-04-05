import { z } from 'zod'
import { Sandbox } from '@vercel/sandbox'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getIntegration } from '@/lib/storage/neon'
import { mcpConfigCache, sourceOverride } from '@/lib/storage/redis'
import { isValidUUID } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'
import { BUILD_VERSION, config } from '@/lib/config'
import type { MCPServerConfig } from '@/lib/mcp/types'

export const maxDuration = 120

const SERVER_WARMUP_MS = config.sandbox.serverWarmupMs

const bodySchema = z.object({
  sandboxId: z.string().min(1),
})

/**
 * POST /api/integrate/[integrationId]/sandbox/reload
 *
 * Hot-reloads edited code into the running sandbox VM:
 * reconnects via Sandbox.get(), writes the updated file,
 * rebuilds, restarts, and verifies MCP tools.
 */
export async function POST(
  req: Request,
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

  const raw = await req.json()
  const parsed = bodySchema.safeParse(raw)

  if (!parsed.success) {
    return errors.badRequest('Invalid request body.')
  }

  const { sandboxId } = parsed.data

  // Read the edited source from Redis
  const override = await sourceOverride.get(integrationId)

  if (!override) {
    return errors.badRequest('No source override to reload.')
  }

  // Load config for tool verification
  let mcpConfig = await mcpConfigCache.get(integration.spec_hash) as MCPServerConfig | null
  if (!mcpConfig && integration.config_json) mcpConfig = integration.config_json as MCPServerConfig

  if (!mcpConfig) {
    return errors.notFound('Config not cached.')
  }

  // Reconnect to the running sandbox
  let sandbox: Sandbox

  try {
    sandbox = await Sandbox.get({ sandboxId })
  } catch (err) {
    console.warn(`[v${BUILD_VERSION}] sandbox/reload: Sandbox.get failed for ${sandboxId}:`, err instanceof Error ? err.message : String(err))
    return success({ ok: false, error: 'sandbox_expired' })
  }

  try {
    // Write the updated route file
    await sandbox.writeFiles([{
      path: 'app/[transport]/route.ts',
      content: Buffer.from(override, 'utf-8'),
    }])

    // Kill the running Next.js server
    await sandbox.runCommand('pkill', ['-f', 'next-server']).catch(() => {
      // Process may already be stopped — not fatal
    })

    // Rebuild
    const build = await sandbox.runCommand('npm', ['run', 'build'])

    if (build.exitCode !== 0) {
      const stderr = await build.stderr()
      console.error(`[v${BUILD_VERSION}] sandbox/reload: build failed:`, stderr)
      return success({ ok: false, error: 'build_failed', stderr })
    }

    // Restart server
    await sandbox.runCommand({ cmd: 'npm', args: ['start'], detached: true })
    await new Promise((resolve) => setTimeout(resolve, SERVER_WARMUP_MS))

    // Verify MCP tools
    const sandboxUrl = sandbox.domain(3000)
    const client = new Client({ name: 'integration-agent-reload', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`${sandboxUrl}/mcp`))

    let returnedTools: Array<{ name: string }>

    try {
      await client.connect(transport)
      const result = await client.listTools()
      returnedTools = result.tools
    } finally {
      await client.close().catch((err) => console.warn('MCP client close failed:', err instanceof Error ? err.message : 'unknown'))
    }

    const returnedNames = returnedTools.map((t) => t.name)
    const expectedNames = mcpConfig.tools.map((t) => t.name)
    const missing = expectedNames.filter((n) => !returnedNames.includes(n))

    if (missing.length > 0) {
      return success({ ok: false, error: 'verification_failed', missing })
    }

    console.log(`[v${BUILD_VERSION}] sandbox/reload: SUCCESS — verified=${returnedNames.length} sandboxId=${sandboxId}`)
    return success({ ok: true, verifiedTools: returnedNames })
  } catch (err) {
    console.error(`[v${BUILD_VERSION}] sandbox/reload: unexpected error:`, err instanceof Error ? err.message : String(err))
    return errors.internal()
  }
}
