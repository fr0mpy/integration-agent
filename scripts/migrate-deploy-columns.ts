/**
 * Migration: add GitHub PR deployment tracking columns to integrations table.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/migrate-deploy-columns.ts
 */

import { neon } from '@neondatabase/serverless'

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL not set')
    process.exit(1)
  }

  const sql = neon(databaseUrl)

  await sql`ALTER TABLE integrations ADD COLUMN IF NOT EXISTS github_repo_url TEXT`
  console.log('✓ github_repo_url')

  await sql`ALTER TABLE integrations ADD COLUMN IF NOT EXISTS github_pr_url TEXT`
  console.log('✓ github_pr_url')

  await sql`ALTER TABLE integrations ADD COLUMN IF NOT EXISTS github_repo_name TEXT`
  console.log('✓ github_repo_name')

  console.log('Migration complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
