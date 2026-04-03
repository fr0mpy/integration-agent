/**
 * Wipe all run data from Neon Postgres, Upstash Redis, and WDK workflow state,
 * then invalidate the Next.js ISR cache so the dashboard reflects the reset.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/clear-db.ts
 */

import { neon } from '@neondatabase/serverless'
import { Redis } from '@upstash/redis'
import { getWorld } from 'workflow/runtime'

async function main() {
  // --- Cancel all WDK workflow runs ---
  try {
    const world = getWorld()
    let cancelled = 0
    let cursor: string | undefined

    // Paginate through all runs and cancel any that are still active
    do {
      const page = await world.runs.list({
        pagination: cursor ? { cursor, limit: 50 } : { limit: 50 },
      })

      for (const run of page.data) {
        if (run.status === 'completed' || run.status === 'cancelled') continue
        try {
          await world.events.create(run.id, { eventType: 'run_cancelled' })
          cancelled++
        } catch (err) {
          console.warn(`Failed to cancel run ${run.id}:`, err instanceof Error ? err.message : String(err))
        }
      }

      cursor = page.pagination?.cursor ?? undefined
    } while (cursor)

    console.log(`Cancelled ${cancelled} active WDK workflow run(s)`)
  } catch (err) {
    console.warn('WDK cleanup failed:', err instanceof Error ? err.message : String(err))
  }

  // --- Neon Postgres ---
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('DATABASE_URL not set — skipping Postgres')
  } else {
    const sql = neon(databaseUrl)
    // credentials has FK → integrations, so delete it first
    const credsResult = await sql`DELETE FROM credentials` as unknown as { rowCount: number }
    console.log(`Deleted ${credsResult.rowCount ?? 0} credential row(s)`)
    const intResult = await sql`DELETE FROM integrations` as unknown as { rowCount: number }
    console.log(`Deleted ${intResult.rowCount ?? 0} integration row(s)`)
  }

  // --- Upstash Redis ---
  // Clears all keys: url:*, cache:*, discovery:*, sourceOverride:*, lock:*
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN

  if (!redisUrl || !redisToken) {
    console.error('Redis env vars not set — skipping Redis flush')
  } else {
    const redis = new Redis({ url: redisUrl, token: redisToken })
    await redis.flushdb()
    console.log('Redis flushed (url:*, cache:*, discovery:*, sourceOverride:*, lock:*)')
  }

  // --- Next.js ISR cache invalidation ---
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const revalidateSecret = process.env.REVALIDATE_SECRET

  if (!appUrl || !revalidateSecret) {
    console.warn('NEXT_PUBLIC_APP_URL or REVALIDATE_SECRET not set — skipping cache invalidation')
  } else {
    try {
      const res = await fetch(`${appUrl}/api/revalidate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${revalidateSecret}` },
      })
      if (res.ok) {
        console.log('Next.js ISR cache invalidated (integrations tag)')
      } else {
        console.warn(`Cache invalidation failed: ${res.status} ${res.statusText}`)
      }
    } catch (err) {
      console.warn('Cache invalidation request failed:', err instanceof Error ? err.message : String(err))
    }
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
