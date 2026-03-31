import { Sandbox } from '@vercel/sandbox'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { BundleResult } from '../mcp/bundle'
import type { MCPServerConfig } from '../mcp/types'

export interface SandboxResult {
  ok: boolean
  verifiedTools: string[]
  sandboxUrl: string
  errors?: string
}

const BUILD_TIMEOUT_MS = 120_000
const SERVER_WARMUP_MS = 3_000

/**
 * Stage 3.5 — Sandbox live MCP test.
 *
 * 1. Writes generated files into a Vercel Sandbox Firecracker VM
 * 2. Runs npm install + next build (validates TypeScript compiles)
 * 3. Starts the server detached on port 3000
 * 4. Connects with an MCP client and calls list_tools
 * 5. Verifies the returned tool names match validatedConfig.tools
 * 6. Destroys the sandbox
 */
export async function runSandboxCheck(
  bundle: BundleResult,
  config: MCPServerConfig,
  onLog?: (log: string) => void,
): Promise<SandboxResult> {
  const sandbox = await Sandbox.create({
    runtime: 'node24',
    ports: [3000],
    env: { MCP_BASE_URL: config.baseUrl },
    timeout: BUILD_TIMEOUT_MS,
  })

  try {
    // Write all generated files
    await sandbox.writeFiles(
      bundle.files.map((f) => ({
        path: f.file,
        content: Buffer.from(f.data, 'utf-8'),
      })),
    )

    onLog?.('Installing dependencies...')

    // npm install
    const install = await sandbox.runCommand('npm', ['install', '--prefer-offline'])
    if (install.exitCode !== 0) {
      const stderr = await install.stderr()
      return { ok: false, verifiedTools: [], sandboxUrl: '', errors: stderr }
    }

    onLog?.('Building...')

    // next build
    const build = await sandbox.runCommand('npm', ['run', 'build'])
    if (build.exitCode !== 0) {
      const stderr = await build.stderr()
      return { ok: false, verifiedTools: [], sandboxUrl: '', errors: stderr }
    }

    onLog?.('Starting MCP server...')

    // Start server in background
    await sandbox.runCommand({ cmd: 'npm', args: ['start'], detached: true })

    // Give Next.js a moment to bind
    await new Promise((resolve) => setTimeout(resolve, SERVER_WARMUP_MS))

    const sandboxUrl = sandbox.domain(3000)
    onLog?.(`Server live at ${sandboxUrl}`)

    // Connect MCP client and call list_tools
    const client = new Client({ name: 'integration-agent-validator', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`${sandboxUrl}/mcp`))
    await client.connect(transport)

    const { tools: returnedTools } = await client.listTools()
    await client.close()

    const returnedNames = returnedTools.map((t) => t.name)
    const expectedNames = config.tools.map((t) => t.name)
    const missing = expectedNames.filter((n) => !returnedNames.includes(n))

    if (missing.length > 0) {
      return {
        ok: false,
        verifiedTools: returnedNames,
        sandboxUrl,
        errors: `Missing tools in live server: ${missing.join(', ')}`,
      }
    }

    onLog?.(`${returnedNames.length}/${expectedNames.length} tools verified`)

    return { ok: true, verifiedTools: returnedNames, sandboxUrl }
  } finally {
    await sandbox.stop()
  }
}
