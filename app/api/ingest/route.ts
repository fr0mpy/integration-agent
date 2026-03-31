import { createHash, randomUUID } from 'crypto'
import { z } from 'zod'
import { Ratelimit } from '@upstash/ratelimit'
import {
  getCachedConfig,
  getCachedSpecHash,
  setCachedSpecHash,
} from '@/lib/storage/redis'
import { redis } from '@/lib/storage/redis'
import { createIntegration } from '@/lib/storage/neon'
import { validateAndFetchSpec, ValidationError } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'),
})

const bodySchema = z.object({
  specUrl: z.string().url('Provide a valid specUrl.'),
})

export async function POST(req: Request) {
  try {
    const ip = req.headers.get('x-real-ip') ?? 'anonymous'
    const { success: allowed } = await ratelimit.limit(ip)

    if (!allowed) {
      return errors.tooManyRequests()
    }

    const body = await req.json()
    const { specUrl } = bodySchema.parse(body)

    // Fast path: check cache before doing any DNS/network work
    const knownHash = await getCachedSpecHash(specUrl)

    if (knownHash) {
      const cached = await getCachedConfig(knownHash)

      if (cached) {
        const integrationId = randomUUID()
        await createIntegration(integrationId, knownHash)
        return success({ integrationId, cached: true })
      }
    }

    // Slow path: validate URL, resolve DNS, and fetch atomically
    const spec = await validateAndFetchSpec(specUrl)

    const specHash = createHash('sha256')
      .update(JSON.stringify(spec))
      .digest('hex')

    // Cache the URL → hash mapping for future fast-path lookups
    await setCachedSpecHash(specUrl, specHash)

    const cached = await getCachedConfig(specHash)
    const integrationId = randomUUID()
    await createIntegration(integrationId, specHash)

    return success({
      integrationId,
      cached: cached !== null,
    })
  } catch (err) {
    console.error('Ingest error:', err)

    if (err instanceof z.ZodError) {
      return errors.badRequest(err.errors.map((e) => e.message).join(', '))
    }

    if (err instanceof ValidationError) {
      return errors.badRequest(err.message)
    }

    return errors.internal()
  }
}
