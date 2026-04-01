/**
 * One-time script to create a Vercel Sandbox snapshot with the MCP server
 * template dependencies pre-installed (mcp-handler, next, zod, typescript).
 *
 * With a snapshot, sandbox startup during pipeline validation drops from
 * ~3 minutes (npm install from scratch) to ~10 seconds.
 *
 * Usage:
 *   npx tsx scripts/create-sandbox-snapshot.ts
 *
 * Then add the printed SANDBOX_SNAPSHOT_ID to:
 *   - .env.local
 *   - Vercel environment variables (vercel env add SANDBOX_SNAPSHOT_ID)
 */

import { Sandbox } from '@vercel/sandbox'

const TEMPLATE_PACKAGE_JSON = JSON.stringify({
  name: 'mcp-server',
  version: '1.0.0',
  private: true,
  scripts: {
    build: 'next build',
    start: 'next start -p 3000',
    dev: 'next dev -p 3000',
  },
  dependencies: {
    'mcp-handler': '^1.1.0',
    next: '16.2.1',
    zod: '^3.25.17',
  },
  devDependencies: {
    '@types/node': '^22.0.0',
    typescript: '^5.0.0',
  },
}, null, 2)

async function main() {
  console.log('Creating Vercel Sandbox snapshot...')
  console.log('This installs the MCP server template dependencies once.')
  console.log('Subsequent pipeline runs will boot from this image.\n')

  const sandbox = await Sandbox.create({
    runtime: 'node24',
    timeout: 300_000, // 5 min for install
  })

  console.log(`Sandbox created: ${sandbox.sandboxId}`)
  console.log('Installing dependencies...')

  await sandbox.writeFiles([{
    path: 'package.json',
    content: Buffer.from(TEMPLATE_PACKAGE_JSON, 'utf-8'),
  }])

  const install = await sandbox.runCommand('npm', ['install'])
  if (install.exitCode !== 0) {
    const stderr = await install.stderr()
    console.error('npm install failed:', stderr)
    await sandbox.stop()
    process.exit(1)
  }

  console.log('Dependencies installed. Taking snapshot...')

  const snapshot = await sandbox.snapshot()

  console.log('\n✓ Snapshot created successfully\n')
  console.log(`SANDBOX_SNAPSHOT_ID=${snapshot.snapshotId}`)
  console.log('\nAdd this to your environment:')
  console.log('  echo "SANDBOX_SNAPSHOT_ID=' + snapshot.snapshotId + '" >> .env.local')
  console.log('  vercel env add SANDBOX_SNAPSHOT_ID')
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
