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

export async function createIntegration(id: string, specHash: string) {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — skipping integration insert')
    return
  }

  try {
    const sql = getDb()
    await sql`
      INSERT INTO integrations (id, spec_hash, status, created_at)
      VALUES (${id}, ${specHash}, ${INTEGRATION_STATUS.PENDING}, NOW())
    `
  } catch (err) {
    console.error('Neon query failed (createIntegration):', err instanceof Error ? err.message : 'unknown')
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
) {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — skipping integration update')
    return
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
  } catch (err) {
    console.error('Neon query failed (updateIntegration):', err instanceof Error ? err.message : 'unknown')
  }
}

/** SQL to create the integrations table — run once during setup */
export const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    spec_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    mcp_url TEXT,
    deployment_id TEXT,
    run_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS credentials (
    integration_id TEXT PRIMARY KEY REFERENCES integrations(id),
    encrypted_value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`
