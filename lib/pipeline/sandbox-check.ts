import { Sandbox } from '@vercel/sandbox'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { BundleResult } from '../mcp/bundle'
import type { MCPServerConfig } from '../mcp/types'

export interface SandboxResult {
  ok: boolean
  verifiedTools: string[]
  sandboxUrl: string
  sandboxId: string | null
  errors?: string
  buildLogs: string[]
}

const SANDBOX_LIVE_TIMEOUT_MS = 30 * 60 * 1000  // keep alive for chat use
const SERVER_WARMUP_MS = 3_000

/**
 * Stage 3.5 — Sandbox live MCP test.
 *
 * 1. Writes generated files into a Vercel Sandbox Firecracker VM
 * 2. Runs npm install + next build (validates TypeScript compiles)
 * 3. Starts the server detached on port 3000
 * 4. Connects with an MCP client and calls list_tools
 * 5. Verifies the returned tool names match validatedConfig.tools
 * 6. Destroys the sandbox on failure; leaves it running on success for chat use
 */
export async function runSandboxCheck(
  bundle: BundleResult,
  config: MCPServerConfig,
): Promise<SandboxResult> {
  const snapshotId = process.env.SANDBOX_SNAPSHOT_ID
  const logs: string[] = []

  let sandbox: Sandbox
  try {
    sandbox = await Sandbox.create({
      ...(snapshotId
        ? { source: { type: 'snapshot', snapshotId } }
        : { runtime: 'node24' }),
      ports: [3000],
      env: { MCP_BASE_URL: config.baseUrl },
      timeout: SANDBOX_LIVE_TIMEOUT_MS,
    })
  } catch (err) {
    return {
      ok: false,
      verifiedTools: [],
      sandboxUrl: '',
      sandboxId: null,
      errors: `Sandbox creation failed: ${err instanceof Error ? err.message : String(err)}`,
      buildLogs: [],
    }
  }

  let failed = false
  try {
    // Write all generated files
    await sandbox.writeFiles(
      bundle.files.map((f) => ({
        path: f.file,
        content: Buffer.from(f.data, 'utf-8'),
      })),
    )

    logs.push('Installing dependencies...')

    // npm install
    const install = await sandbox.runCommand('npm', ['install', '--prefer-offline'])
    if (install.exitCode !== 0) {
      failed = true
      const stderr = await install.stderr()
      return { ok: false, verifiedTools: [], sandboxUrl: '', sandboxId: null, errors: stderr, buildLogs: logs }
    }

    logs.push('Building...')

    // next build
    const build = await sandbox.runCommand('npm', ['run', 'build'])
    if (build.exitCode !== 0) {
      failed = true
      const stderr = await build.stderr()
      return { ok: false, verifiedTools: [], sandboxUrl: '', sandboxId: null, errors: stderr, buildLogs: logs }
    }

    logs.push('Starting MCP server...')

    // Start server in background
    await sandbox.runCommand({ cmd: 'npm', args: ['start'], detached: true })

    // Give Next.js a moment to bind
    await new Promise((resolve) => setTimeout(resolve, SERVER_WARMUP_MS))

    const sandboxUrl = sandbox.domain(3000)
    logs.push(`Server live at ${sandboxUrl}`)

    // Connect MCP client and call list_tools — always close client in finally
    const client = new Client({ name: 'integration-agent-validator', version: '1.0.0' })
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
      return {
        ok: false,
        verifiedTools: returnedNames,
        sandboxUrl,
        sandboxId: null,
        errors: `Missing tools in live server: ${missing.join(', ')}`,
        buildLogs: logs,
      }
    }

    logs.push(`${returnedNames.length}/${expectedNames.length} tools verified`)

    // Success — leave sandbox running (30 min TTL) for chat callTool use
    return { ok: true, verifiedTools: returnedNames, sandboxUrl, sandboxId: sandbox.sandboxId, buildLogs: logs }
  } finally {
    // Only stop on failure — successful sandboxes stay alive for the chat panel
    if (failed) await sandbox.stop()
  }
}
