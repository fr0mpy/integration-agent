'use server'

import { neon } from '@neondatabase/serverless'
import { Redis } from '@upstash/redis'
import { getWorld } from 'workflow/runtime'
import { revalidateTag } from 'next/cache'

export async function clearData(): Promise<{ success: boolean; message: string }> {
  try {
    // Cancel active WDK workflow runs
    try {
      const world = getWorld()
      let cancelled = 0
      let cursor: string | undefined
      let hasMore = true

      while (hasMore) {
        const page = await world.runs.list({
          pagination: cursor ? { cursor, limit: 50 } : { limit: 50 },
        })

        for (const run of page.data) {
          if (run.status === 'completed' || run.status === 'cancelled') continue
          try {
            await world.events.create(run.runId, { eventType: 'run_cancelled' })
            cancelled++
          } catch {}
        }

        cursor = page.cursor ?? undefined
        hasMore = !!page.hasMore && !!cursor
      }

      console.log(`Cancelled ${cancelled} active WDK workflow run(s)`)
    } catch (err) {
      console.warn('WDK cleanup failed:', err instanceof Error ? err.message : String(err))
    }

    // Neon Postgres
    const databaseUrl = process.env.DATABASE_URL
    if (databaseUrl) {
      const sql = neon(databaseUrl)
      await sql`DELETE FROM credentials`
      await sql`DELETE FROM integrations`
    }

    // Upstash Redis
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
    if (redisUrl && redisToken) {
      const redis = new Redis({ url: redisUrl, token: redisToken })
      await redis.flushdb()
    }

    // Revalidate ISR cache
    revalidateTag('integrations', 'hours')

    return { success: true, message: 'All data cleared' }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Unknown error' }
  }
}
