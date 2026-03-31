import { NextResponse } from 'next/server'
import { getIntegration } from '@/lib/storage/neon'
import { configCache } from '@/lib/storage/redis'
import { bundleServer } from '@/lib/mcp/bundle'
import type { MCPServerConfig } from '@/lib/mcp/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  try {
    const { integrationId } = await params

    if (!UUID_RE.test(integrationId)) {
      return NextResponse.json({ error: 'Invalid integration ID' }, { status: 400 })
    }

    const integration = await getIntegration(integrationId)
    if (!integration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    const config = await configCache.get(integration.spec_hash) as MCPServerConfig | null
    if (!config) {
      return NextResponse.json({ error: 'Config not cached yet' }, { status: 404 })
    }

    const { files } = bundleServer(config)
    return NextResponse.json({ files })
  } catch (err) {
    console.error('Files route error:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
