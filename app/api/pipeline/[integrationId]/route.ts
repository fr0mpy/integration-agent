import { getRun } from 'workflow/api'
import { getIntegration } from '@/lib/storage/neon'
import { configCache, discoveryCache } from '@/lib/storage/redis'
import { success, errors } from '@/lib/api/response'
import type { PipelineEvent } from '@/lib/pipeline/events'

import { isValidUUID } from '@/lib/validation'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const

/** Send a single SSE error event and close the stream. */
function sseError(message: string): Response {
  const event: PipelineEvent = {
    stage: 'discover-api',
    status: 'failed',
    data: { error: message },
    timestamp: Date.now(),
  }
  const body = `data: ${JSON.stringify(event)}\n\n`
  return new Response(body, { headers: SSE_HEADERS })
}

/**
 * GET: Connect (or reconnect) to a running pipeline's stream.
 * Always returns text/event-stream so EventSource can handle errors gracefully.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  try {
    const { integrationId } = await params

    if (!isValidUUID(integrationId)) {
      return sseError('Invalid integration ID.')
    }

    const integration = await getIntegration(integrationId)

    if (!integration) {
      return sseError('Integration not found.')
    }

    const url = new URL(req.url)

    // Cached path: return config as JSON (no workflow involved)
    if (url.searchParams.get('cached') === 'true') {
      const specHash = integration.spec_hash as string
      const [config, discovery] = await Promise.all([
        configCache.get(specHash),
        discoveryCache.get(specHash),
      ])

      if (!config) {
        return errors.notFound('Cached config not found.')
      }

      return success({ config, discovery: discovery ?? null })
    }

    // Poll for run_id — handles race where workflow start hasn't written it yet
    let runId = integration.run_id as string | null

    if (!runId) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, 1000))
        const updated = await getIntegration(integrationId)
        runId = (updated?.run_id as string | null) ?? null
        if (runId) break
      }

      if (!runId) {
        return sseError('Pipeline failed to start. Please try again.')
      }
    }

    // Support reconnection from a specific index
    const lastIndexParam = url.searchParams.get('lastIndex')
    let startIndex = 0

    if (lastIndexParam !== null) {
      const parsed = parseInt(lastIndexParam, 10)

      if (!Number.isInteger(parsed) || parsed < 0) {
        return sseError('Invalid lastIndex parameter.')
      }

      startIndex = parsed + 1
    }

    const run = getRun(runId)
    const readable = run.getReadable<PipelineEvent>({ startIndex })

    // Transform workflow chunks into SSE format
    const encoder = new TextEncoder()
    const sseStream = readable.pipeThrough(
      new TransformStream<PipelineEvent, Uint8Array>({
        transform(event, controller) {
          try {
            const data = JSON.stringify(event)
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          } catch (err) {
            console.error('SSE transform error:', err instanceof Error ? err.message : 'unknown')
            controller.error(err)
          }
        },
      }),
    )

    return new Response(sseStream, { headers: SSE_HEADERS })
  } catch (err) {
    console.error('Pipeline stream error:', err instanceof Error ? err.message : 'unknown')
    return sseError('Pipeline stream failed. Please try again.')
  }
}
