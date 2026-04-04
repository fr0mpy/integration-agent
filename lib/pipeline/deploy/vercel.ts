import { Vercel } from '@vercel/sdk'
import { config } from '../../config'

// Capture native fetch at module load time before Vercel Workflow DevKit can
// intercept globalThis.fetch inside 'use step' functions.
const _fetch = globalThis.fetch

export interface VercelProjectResult {
  vercelProjectId: string
  projectName: string
  setupLogs: string[]
}

export interface VercelDeployResult {
  vercelProjectId: string
  deploymentId: string
  mcpUrl: string
  buildLogs: string[]
}

interface SharedEnvVar {
  id: string
  key: string
  projectId: string[]
}

const VERCEL_API = config.deploy.vercelApi
const VERCEL_BUILD_TIMEOUT_MS = config.deploy.buildTimeoutMs
const DEPLOY_APPEAR_TIMEOUT_MS = config.deploy.appearTimeoutMs
const DEPLOY_POLL_INTERVAL_MS = config.deploy.pollIntervalMs

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/**
 * Ensures team-level shared env vars exist for HMAC_SECRET and CREDENTIAL_ENDPOINT.
 * Creates them if absent; links the given projectId to each if not already linked.
 * Falls back to per-project injection if the PATCH to update project list fails.
 */
async function ensureSharedEnvVars(projectId: string, token: string, teamId: string | undefined): Promise<void> {
  const hmacSecret = process.env.CREDENTIAL_HMAC_SECRET
  const credentialEndpoint = process.env.NEXT_PUBLIC_APP_URL

  if (!hmacSecret || !credentialEndpoint) {
    throw new Error('CREDENTIAL_HMAC_SECRET and NEXT_PUBLIC_APP_URL must be set to deploy MCP servers')
  }

  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  // Fetch existing shared vars
  const listRes = await _fetch(`${VERCEL_API}/v1/env${qs}`, { headers })
  if (!listRes.ok) throw new Error(`Vercel shared env list failed: ${listRes.status}`)
  const { data } = (await listRes.json()) as { data: SharedEnvVar[] }

  const toManage = [
    { key: config.deploy.envKeys.hmacSecret, value: hmacSecret },
    { key: config.deploy.envKeys.credentialEndpoint, value: credentialEndpoint },
  ]

  for (const { key, value } of toManage) {
    const existing = data.find((v) => v.key === key)

    if (!existing) {
      // Create shared var linked to this project
      const res = await _fetch(`${VERCEL_API}/v1/env${qs}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          evs: [{ key, value }],
          type: 'encrypted',
          target: ['production'],
          projectId: [projectId],
        }),
      })

      if (!res.ok) {
        console.error(`Failed to create shared env var ${key} (${res.status})`)
        throw new Error(`Failed to create shared env var ${key} (status ${res.status})`)
      }
    } else if (!existing.projectId.includes(projectId)) {
      // Link this project to the existing shared var
      const patchRes = await _fetch(`${VERCEL_API}/v1/env/${existing.id}${qs}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ projectId: [...existing.projectId, projectId] }),
      })

      if (!patchRes.ok) {
        // PATCH not supported — fall back to per-project injection
        await injectProjectEnvVar(projectId, key, value, token, teamId)
      }
    }
    // else: already linked — nothing to do
  }
}

/**
 * Injects a single per-project encrypted environment variable via the Vercel REST API.
 */
async function injectProjectEnvVar(
  projectId: string,
  key: string,
  value: string,
  token: string,
  teamId: string | undefined,
): Promise<void> {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
  const res = await _fetch(`${VERCEL_API}/v10/projects/${projectId}/env${qs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, type: 'encrypted', target: ['production'] }),
  })

  if (!res.ok) {
    throw new Error(`Failed to inject env var ${key} (status ${res.status})`)
  }
}

// Normalises an API name to a URL-safe lowercase slug for use as the Vercel project name.
function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/**
 * Create a Vercel project linked to the monorepo subdirectory and inject env vars.
 * Idempotent — reuses the existing project if a retry occurs.
 */
export async function createVercelProject(
  monorepo: { repoOwner: string; repoName: string },
  integrationId: string,
  integrationName: string,
): Promise<VercelProjectResult> {
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN is not set')
  const vercel = new Vercel({ bearerToken: token })
  const teamId = process.env.VERCEL_TEAM_ID
  const projectName = `mcp-${sanitize(integrationName)}-${integrationId.slice(0, 6)}`
  const rootDirectory = `mcps/${integrationId}`
  const logs: string[] = []

  // Idempotency guard: if this step is retried, reuse the project that was already created.
  let projectId: string | undefined
  const checkRes = await _fetch(
    `${VERCEL_API}/v9/projects/${encodeURIComponent(projectName)}${teamId ? `?teamId=${teamId}` : ''}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (checkRes.ok) {
    const existing = (await checkRes.json()) as { id: string }
    projectId = existing.id
    logs.push(`Reusing existing Vercel project: ${projectName} (id: ${projectId})`)
  }

  if (!projectId) {
    logs.push(`Creating Vercel project: ${projectName}`)
    const project = await vercel.projects.createProject({
      ...(teamId ? { teamId } : {}),
      requestBody: {
        name: projectName,
        framework: 'nextjs',
        rootDirectory,
        gitRepository: {
          repo: `${monorepo.repoOwner}/${monorepo.repoName}`,
          type: 'github',
        },
        ssoProtection: null,
      },
    })
    projectId = project.id
    logs.push(`Project created (id: ${projectId}) — setting environment variables...`)

    // Inject env vars before the first build starts.
    // HMAC_SECRET and CREDENTIAL_ENDPOINT are managed as Vercel Shared Env Vars
    // so rotating them requires updating a single team-level value.
    // INTEGRATION_ID is per-project and always injected directly.
    await ensureSharedEnvVars(projectId, token, teamId)
    await injectProjectEnvVar(projectId, config.deploy.envKeys.integrationId, integrationId, token, teamId)
    logs.push('Environment variables set.')
  }

  return { vercelProjectId: projectId, projectName, setupLogs: logs }
}

export interface DeploymentInfo {
  uid: string
  readyState: string
  url: string
}

/**
 * Single API call: check if a deployment exists on the project.
 * Returns the most recent deployment or null if none queued yet.
 */
export async function findDeployment(vercelProjectId: string): Promise<DeploymentInfo | null> {
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN is not set')
  const vercel = new Vercel({ bearerToken: token })
  const teamId = process.env.VERCEL_TEAM_ID

  const resp = await vercel.deployments.getDeployments({
    projectId: vercelProjectId,
    limit: 1,
    ...(teamId ? { teamId } : {}),
  })

  const dep = resp.deployments?.[0]
  if (!dep) return null

  return { uid: dep.uid, readyState: dep.readyState ?? 'unknown', url: dep.url ?? '' }
}

/**
 * Ping the project's production URL to check if the deployment is live.
 * Returns true if the server responds with a non-5xx status.
 */
export async function pingDeployment(projectName: string): Promise<boolean> {
  try {
    const res = await _fetch(`https://${projectName}.vercel.app`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    })
    return res.status < 500
  } catch {
    return false
  }
}
