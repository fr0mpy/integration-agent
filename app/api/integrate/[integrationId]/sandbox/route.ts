import { Sandbox } from '@vercel/sandbox'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getIntegration } from '@/lib/storage/neon'
import { mcpConfigCache, sourceOverride } from '@/lib/storage/redis'
import { bundleServer } from '@/lib/mcp/bundle'
import { isValidUUID } from '@/lib/validation'
import { errors } from '@/lib/api/response'
import { BUILD_VERSION } from '@/lib/config'
import type { MCPServerConfig } from '@/lib/mcp/types'

export const maxDuration = 300

const SANDBOX_LIVE_TIMEOUT_MS = 30 * 60 * 1000
const SERVER_WARMUP_MS = 3_000

/**
 * POST /api/integrate/[integrationId]/sandbox
 *
 * Spins up a fresh sandbox VM from the cached config and streams build logs
 * as ndjson lines.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  const { integrationId } = await params

  if (!isValidUUID(integrationId)) {
    return errors.badRequest('Invalid integration ID.')
  }

  const integration = await getIntegration(integrationId)

  console.log(`[v${BUILD_VERSION}] sandbox/route: integrationId=${integrationId} found=${!!integration} status=${integration?.status} spec_hash=${integration?.spec_hash?.slice(0, 12)}`)

  if (!integration) {
    return errors.notFound('Integration not found.')
  }

  // Try Redis first, fall back to Postgres (Redis writes are unreliable inside WDK steps)
  let config = await mcpConfigCache.get(integration.spec_hash) as MCPServerConfig | null

  if (!config && integration.config_json) {
    console.log(`[v${BUILD_VERSION}] sandbox/route: Redis miss, using Postgres config_json`)
    config = integration.config_json as MCPServerConfig
  }

  console.log(`[v${BUILD_VERSION}] sandbox/route: config found=${!!config} source=${config ? (integration.config_json ? 'postgres' : 'redis') : 'none'} spec_hash=${integration.spec_hash?.slice(0, 12)} toolCount=${config?.tools?.length ?? 0}`)

  if (!config) {
    // If the pipeline is still running (status=validating), the client likely hit this
    // endpoint before persistValidation completed — signal a retryable error.
    if (integration.status === 'validating') {
      return errors.serviceUnavailable('Sandbox URL not yet persisted. Retry in a moment.')
    }
    console.error(`[v${BUILD_VERSION}] sandbox/route: CONFIG NOT FOUND — spec_hash=${integration.spec_hash} status=${integration.status}`)
    return errors.notFound('Config not cached. Re-run the pipeline first.')
  }

  // Regenerate bundle from cached config (with any source overrides)
  const override = await sourceOverride.get(integrationId)
  const baseBundle = bundleServer(config)
  const bundle = override
    ? {
        ...baseBundle,
        sourceCode: override,
        files: baseBundle.files.map((f) =>
          f.file === 'app/[transport]/route.ts' ? { ...f, data: override } : f,
        ),
      }
    : baseBundle

  // Stream ndjson progress
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'))
      }

      let sandbox: Sandbox
      let failed = false

      try {
        send({ type: 'log', message: 'Setting up sandbox...' })

        const snapshotId = process.env.SANDBOX_SNAPSHOT_ID
        console.log(`[v${BUILD_VERSION}] sandbox/route: creating sandbox snapshotId=${snapshotId ?? 'none'} baseUrl=${config.baseUrl}`)

        sandbox = await Sandbox.create({
          ...(snapshotId
            ? { source: { type: 'snapshot', snapshotId } }
            : { runtime: 'node24' }),
          ports: [3000],
          env: { MCP_BASE_URL: config.baseUrl },
          timeout: SANDBOX_LIVE_TIMEOUT_MS,
        })

        console.log(`[v${BUILD_VERSION}] sandbox/route: sandbox created id=${sandbox.sandboxId}`)
      } catch (err) {
        console.error(`[v${BUILD_VERSION}] sandbox/route: Sandbox.create FAILED:`, err instanceof Error ? err.stack : String(err))
        send({ type: 'error', message: 'Sandbox creation failed.' })
        controller.close()
        return
      }

      try {
        await sandbox.writeFiles(
          bundle.files.map((f) => ({
            path: f.file,
            content: Buffer.from(f.data, 'utf-8'),
          })),
        )

        send({ type: 'log', message: 'Installing dependencies...' })

        const install = await sandbox.runCommand('npm', ['install'])

        if (install.exitCode !== 0) {
          failed = true
          const stderr = await install.stderr()
          console.error('npm install failed:', stderr)
          send({ type: 'error', message: 'Dependency installation failed.' })
          controller.close()
          return
        }

        send({ type: 'log', message: 'Building...' })

        const build = await sandbox.runCommand('npm', ['run', 'build'])

        if (build.exitCode !== 0) {
          failed = true
          const stderr = await build.stderr()
          console.error('Sandbox build failed:', stderr)
          send({ type: 'error', message: 'Build failed.' })
          controller.close()
          return
        }

        send({ type: 'log', message: 'Starting MCP server...' })

        await sandbox.runCommand({ cmd: 'npm', args: ['start'], detached: true })
        await new Promise((resolve) => setTimeout(resolve, SERVER_WARMUP_MS))

        const sandboxUrl = sandbox.domain(3000)
        console.log(`[v${BUILD_VERSION}] sandbox/route: domain=${sandboxUrl} sandboxId=${sandbox.sandboxId}`)
        send({ type: 'log', message: 'MCP server started — verifying tools...' })

        // Verify MCP tools
        const client = new Client({ name: 'integration-agent-respawn', version: '1.0.0' })
        const transport = new StreamableHTTPClientTransport(new URL(`${sandboxUrl}/mcp`))

        let returnedTools: Array<{ name: string }>

        try {
          await client.connect(transport)
          const result = await client.listTools()
          returnedTools = result.tools
        } finally {
          await client.close()
        }

        const returnedNames = returnedTools.map((t) => t.name)
        const expectedNames = config.tools.map((t) => t.name)
        const missing = expectedNames.filter((n) => !returnedNames.includes(n))

        if (missing.length > 0) {
          failed = true
          send({ type: 'error', message: `Missing tools: ${missing.join(', ')}` })
          controller.close()
          return
        }

        send({ type: 'log', message: `${returnedNames.length}/${expectedNames.length} tools verified` })
        send({ type: 'log', message: 'Sandbox live — isolated Firecracker VM' })

        send({ type: 'ready', sandboxUrl, sandboxId: sandbox.sandboxId })
        controller.close()
      } finally {
        if (failed) await sandbox.stop()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    },
  })
}
