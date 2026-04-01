import { createHash, randomUUID } from 'crypto'
import { z } from 'zod'
import { Ratelimit } from '@upstash/ratelimit'
import { redis, urlCache, configCache, lock } from '@/lib/storage/redis'
import { createIntegration, updateIntegration } from '@/lib/storage/neon'
import { validateAndFetchSpec, ValidationError } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'
import { start } from 'workflow/api'
import { synthesisePipeline } from '@/lib/pipeline'

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'),
})

const bodySchema = z.object({
  specUrl: z.string().url('Provide a valid specUrl.').max(2048, 'URL too long (max 2048 chars).'),
})

export async function POST(req: Request) {
  try {
    // Trust only x-vercel-forwarded-for — set by Vercel's edge and not spoofable.
    // x-forwarded-for and x-real-ip are client-controlled and must not be trusted.
    const ip = req.headers.get('x-vercel-forwarded-for') ?? 'anonymous'

    // Fail-closed: if Redis is unavailable, deny rather than proceed unthrottled
    let rateLimitAllowed: boolean
    try {
      const { success: allowed } = await ratelimit.limit(ip)
      rateLimitAllowed = allowed
    } catch (err) {
      console.warn('Rate limit check failed:', err instanceof Error ? err.message : 'unknown')
      rateLimitAllowed = false
    }
    if (!rateLimitAllowed) return errors.tooManyRequests()

    const body = await req.json()
    const { specUrl } = bodySchema.parse(body)

    // Fast path: check cache before doing any DNS/network work
    const knownHash = await urlCache.getHash(specUrl)

    if (knownHash) {
      const cached = await configCache.get(knownHash)

      if (cached) {
        const integrationId = randomUUID()
        const cachedOk = await createIntegration(integrationId, knownHash, specUrl)
        if (!cachedOk) return errors.internal()
        return success({ integrationId, cached: true })
      }
    }

    // Slow path: validate URL, resolve DNS, and fetch atomically
    const spec = await validateAndFetchSpec(specUrl)

    const specHash = createHash('sha256')
      .update(JSON.stringify(spec))
      .digest('hex')

    // Prevent concurrent synthesis of the same spec
    const acquired = await lock.acquire(`synthesis:${specHash}`)
    if (!acquired) {
      return errors.conflict('A synthesis pipeline for this spec is already running.')
    }

    try {
      // Check configCache inside the lock window — catches duplicate specs submitted
      // via different URLs (urlCache misses but content hash matches)
      const cachedInLock = await configCache.get(specHash)
      if (cachedInLock) {
        const integrationId = randomUUID()
        const cachedOk = await createIntegration(integrationId, specHash, specUrl)
        if (!cachedOk) return errors.internal()
        return success({ integrationId, cached: true })
      }

      const integrationId = randomUUID()
      const created = await createIntegration(integrationId, specHash, specUrl)
      if (!created) return errors.internal()

      // Start the durable workflow pipeline
      // URL cache is written inside the pipeline only after successful synthesis
      const run = await start(synthesisePipeline, [integrationId, spec, specHash, specUrl])
      await updateIntegration(integrationId, { run_id: run.runId })

      return success({
        integrationId,
        runId: run.runId,
        cached: false,
      })
    } finally {
      await lock.release(`synthesis:${specHash}`)
    }
  } catch (err) {
    console.error('Synthesise error:', err instanceof Error ? err.message : 'unknown')

    if (err instanceof z.ZodError) {
      return errors.badRequest(err.errors.map((e) => e.message).join(', '))
    }

    if (err instanceof ValidationError) {
      return errors.badRequest(err.message)
    }

    return errors.internal()
  }
}
