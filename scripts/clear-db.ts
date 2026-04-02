/**
 * One-time script to wipe all run data from Neon Postgres and Upstash Redis.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/clear-db.ts
 */

import { neon } from '@neondatabase/serverless'
import { Redis } from '@upstash/redis'

async function main() {
  // --- Neon Postgres ---
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('DATABASE_URL not set — skipping Postgres')
  } else {
    const sql = neon(databaseUrl)
    const { rowCount: creds } = await sql`DELETE FROM credentials`
    console.log(`Deleted ${creds ?? 0} credential row(s)`)
    const { rowCount: integrations } = await sql`DELETE FROM integrations`
    console.log(`Deleted ${integrations ?? 0} integration row(s)`)
  }

  // --- Upstash Redis ---
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN

  if (!redisUrl || !redisToken) {
    console.error('Redis env vars not set — skipping Redis flush')
  } else {
    const redis = new Redis({ url: redisUrl, token: redisToken })
    await redis.flushdb()
    console.log('Redis flushed')
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
