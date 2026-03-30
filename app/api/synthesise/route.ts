import { NextResponse } from 'next/server'
import { createHash, randomUUID } from 'crypto'
import { getCachedConfig } from '@/lib/storage/redis'
import { createIntegration } from '@/lib/storage/neon'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { specUrl } = body as { specUrl?: string }
    if (!specUrl) {
      return NextResponse.json({ error: 'Provide a specUrl.' }, { status: 400 })
    }

    const res = await fetch(specUrl)
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch spec from URL (${res.status}).` },
        { status: 400 }
      )
    }
    const spec = (await res.json()) as Record<string, unknown>

    // Validate it looks like an OpenAPI spec
    if (!spec.openapi && !spec.swagger) {
      return NextResponse.json(
        { error: 'The provided URL does not appear to be an OpenAPI spec.' },
        { status: 400 }
      )
    }

    // Hash the spec for cache lookup
    const specHash = createHash('sha256')
      .update(JSON.stringify(spec))
      .digest('hex')

    // Check cache — if hit, we'll still create an integration record but can skip synthesis later
    const cached = await getCachedConfig(specHash)

    const integrationId = randomUUID()
    await createIntegration(integrationId, specHash)

    return NextResponse.json({
      integrationId,
      cached: cached !== null,
    })
  } catch (err) {
    console.error('Synthesise error:', err)
    const message = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
