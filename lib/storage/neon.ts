import { neon, neonConfig } from '@neondatabase/serverless'

// Default fetch for non-workflow contexts (regular API routes, scripts).
// lib/pipeline/index.ts overrides this with WDK's fetch for use inside workflow steps.
neonConfig.fetchFunction = globalThis.fetch

function getDb() {
  return neon(process.env.DATABASE_URL!)
}

export const INTEGRATION_STATUS = {
  PENDING: 'pending',
  SYNTHESISING: 'synthesising',
  VALIDATING: 'validating',
  DEPLOYING: 'deploying',
  LIVE: 'live',
  FAILED: 'failed',
} as const

export async function createIntegration(id: string, specHash: string, specUrl: string): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — skipping integration insert')
    return false
  }

  try {
    const sql = getDb()
    await sql`
      INSERT INTO integrations (id, spec_hash, spec_url, status, created_at)
      VALUES (${id}, ${specHash}, ${specUrl}, ${INTEGRATION_STATUS.PENDING}, NOW())
    `
    return true
  } catch (err) {
    console.error('Neon query failed (createIntegration):', err instanceof Error ? err.message : 'unknown')
    return false
  }
}

export async function getIntegration(id: string) {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — skipping integration query')
    return null
  }

  try {
    const sql = getDb()
    const rows = await sql`
      SELECT * FROM integrations WHERE id = ${id}
    `
    return rows[0] ?? null
  } catch (err) {
    console.error('Neon query failed (getIntegration):', err instanceof Error ? err.message : 'unknown')
    return null
  }
}

export async function updateIntegration(
  id: string,
  updates: {
    status?: string
    mcp_url?: string
    deployment_id?: string
    run_id?: string
    sandbox_id?: string | null
    sandbox_url?: string
    verified_tools?: string[]
    validated_at?: string
    live_validated_at?: string
    github_repo_url?: string
    github_pr_url?: string
    github_repo_name?: string
  }
): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — skipping integration update')
    return false
  }

  try {
    const sql = getDb()

    // Issue all updates as concurrent HTTP requests (neon HTTP driver).
    // Using Promise.all avoids N serial round-trips while staying within
    // the tagged-template-literal constraint of the neon driver.
    const queries: Promise<unknown>[] = []

    if (updates.status !== undefined)
      queries.push(sql`UPDATE integrations SET status = ${updates.status} WHERE id = ${id}`)
    if (updates.mcp_url !== undefined)
      queries.push(sql`UPDATE integrations SET mcp_url = ${updates.mcp_url} WHERE id = ${id}`)
    if (updates.deployment_id !== undefined)
      queries.push(sql`UPDATE integrations SET deployment_id = ${updates.deployment_id} WHERE id = ${id}`)
    if (updates.run_id !== undefined)
      queries.push(sql`UPDATE integrations SET run_id = ${updates.run_id} WHERE id = ${id}`)
    if (updates.sandbox_id !== undefined)
      queries.push(sql`UPDATE integrations SET sandbox_id = ${updates.sandbox_id} WHERE id = ${id}`)
    if (updates.sandbox_url !== undefined)
      queries.push(sql`UPDATE integrations SET sandbox_url = ${updates.sandbox_url} WHERE id = ${id}`)
    if (updates.verified_tools !== undefined)
      queries.push(sql`UPDATE integrations SET verified_tools = ${updates.verified_tools} WHERE id = ${id}`)
    if (updates.validated_at !== undefined)
      queries.push(sql`UPDATE integrations SET validated_at = ${updates.validated_at} WHERE id = ${id}`)
    if (updates.live_validated_at !== undefined)
      queries.push(sql`UPDATE integrations SET live_validated_at = ${updates.live_validated_at} WHERE id = ${id}`)
    if (updates.github_repo_url !== undefined)
      queries.push(sql`UPDATE integrations SET github_repo_url = ${updates.github_repo_url} WHERE id = ${id}`)
    if (updates.github_pr_url !== undefined)
      queries.push(sql`UPDATE integrations SET github_pr_url = ${updates.github_pr_url} WHERE id = ${id}`)
    if (updates.github_repo_name !== undefined)
      queries.push(sql`UPDATE integrations SET github_repo_name = ${updates.github_repo_name} WHERE id = ${id}`)

    if (queries.length > 0) await Promise.all(queries)

    return true
  } catch (err) {
    console.error('Neon query failed (updateIntegration):', err instanceof Error ? err.message : 'unknown')
    return false
  }
}

export interface IntegrationSummary {
  id: string
  spec_url: string | null
  status: string
  run_id: string | null
  created_at: string
}

export async function listIntegrations(limit = 20): Promise<IntegrationSummary[]> {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — skipping integration list')
    return []
  }

  try {
    const sql = getDb()
    const rows = await sql<IntegrationSummary[]>`
      SELECT id, spec_url, status, run_id, created_at
      FROM integrations
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return rows
  } catch (err) {
    console.error('Neon query failed (listIntegrations):', err instanceof Error ? err.message : 'unknown')
    return []
  }
}

export async function saveCredentials(integrationId: string, encryptedValue: string): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false
  try {
    const sql = getDb()
    await sql`
      INSERT INTO credentials (integration_id, encrypted_value, created_at)
      VALUES (${integrationId}, ${encryptedValue}, NOW())
      ON CONFLICT (integration_id) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value
    `
    return true
  } catch (err) {
    console.error('Neon query failed (saveCredentials):', err instanceof Error ? err.message : 'unknown')
    return false
  }
}

export async function getCredentials(integrationId: string): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null
  try {
    const sql = getDb()
    const rows = await sql`SELECT encrypted_value FROM credentials WHERE integration_id = ${integrationId}`
    return (rows[0]?.encrypted_value as string) ?? null
  } catch (err) {
    console.error('Neon query failed (getCredentials):', err instanceof Error ? err.message : 'unknown')
    return null
  }
}

export async function hasCredentials(integrationId: string): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false
  try {
    const sql = getDb()
    const rows = await sql`SELECT 1 FROM credentials WHERE integration_id = ${integrationId} LIMIT 1`
    return rows.length > 0
  } catch (err) {
    console.error('Neon query failed (hasCredentials):', err instanceof Error ? err.message : 'unknown')
    return false
  }
}

/** SQL to create the integrations table — run once during setup */
export const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    spec_hash TEXT NOT NULL,
    spec_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    mcp_url TEXT,
    deployment_id TEXT,
    run_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Migration: add spec_url if it doesn't exist yet
  ALTER TABLE integrations ADD COLUMN IF NOT EXISTS spec_url TEXT;

  -- Migration: sandbox validation tracking
  ALTER TABLE integrations ADD COLUMN IF NOT EXISTS sandbox_id TEXT;
  ALTER TABLE integrations ADD COLUMN IF NOT EXISTS sandbox_url TEXT;
  ALTER TABLE integrations ADD COLUMN IF NOT EXISTS verified_tools TEXT[];
  ALTER TABLE integrations ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
  ALTER TABLE integrations ADD COLUMN IF NOT EXISTS live_validated_at TIMESTAMPTZ;

  -- Migration: GitHub PR deployment tracking
  ALTER TABLE integrations ADD COLUMN IF NOT EXISTS github_repo_url TEXT;
  ALTER TABLE integrations ADD COLUMN IF NOT EXISTS github_pr_url TEXT;
  ALTER TABLE integrations ADD COLUMN IF NOT EXISTS github_repo_name TEXT;

  CREATE TABLE IF NOT EXISTS credentials (
    integration_id TEXT PRIMARY KEY REFERENCES integrations(id),
    encrypted_value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`
