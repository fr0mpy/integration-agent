import { neon } from '@neondatabase/serverless'

function getDb() {
  return neon(process.env.DATABASE_URL!)
}

export async function createIntegration(id: string, specHash: string) {
  const sql = getDb()
  await sql`
    INSERT INTO integrations (id, spec_hash, status, created_at)
    VALUES (${id}, ${specHash}, 'pending', NOW())
  `
}

export async function getIntegration(id: string) {
  const sql = getDb()
  const rows = await sql`
    SELECT * FROM integrations WHERE id = ${id}
  `
  return rows[0] ?? null
}

export async function updateIntegration(
  id: string,
  updates: { status?: string; mcp_url?: string; deployment_id?: string; run_id?: string }
) {
  const sql = getDb()
  const setClauses: string[] = []
  const values: unknown[] = []

  if (updates.status !== undefined) {
    setClauses.push('status')
    values.push(updates.status)
  }
  if (updates.mcp_url !== undefined) {
    setClauses.push('mcp_url')
    values.push(updates.mcp_url)
  }
  if (updates.deployment_id !== undefined) {
    setClauses.push('deployment_id')
    values.push(updates.deployment_id)
  }
  if (updates.run_id !== undefined) {
    setClauses.push('run_id')
    values.push(updates.run_id)
  }

  // Use individual update queries for each field since neon() tagged template
  // doesn't support dynamic column names
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
