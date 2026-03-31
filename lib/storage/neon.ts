import { neon } from '@neondatabase/serverless'

function getDb() {
  return neon(process.env.DATABASE_URL!)
}

export const INTEGRATION_STATUS = {
  PENDING: 'pending',
  SYNTHESISING: 'synthesising',
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
  updates: { status?: string; mcp_url?: string; deployment_id?: string; run_id?: string }
): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — skipping integration update')
    return false
  }

  try {
    const sql = getDb()

    if (updates.status !== undefined) {
      await sql`UPDATE integrations SET status = ${updates.status} WHERE id = ${id}`
    }

    if (updates.mcp_url !== undefined) {
      await sql`UPDATE integrations SET mcp_url = ${updates.mcp_url} WHERE id = ${id}`
    }

    if (updates.deployment_id !== undefined) {
      await sql`UPDATE integrations SET deployment_id = ${updates.deployment_id} WHERE id = ${id}`
    }

    if (updates.run_id !== undefined) {
      await sql`UPDATE integrations SET run_id = ${updates.run_id} WHERE id = ${id}`
    }

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

  CREATE TABLE IF NOT EXISTS credentials (
    integration_id TEXT PRIMARY KEY REFERENCES integrations(id),
    encrypted_value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`
