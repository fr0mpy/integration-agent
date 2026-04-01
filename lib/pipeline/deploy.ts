import { Octokit } from '@octokit/rest'
import { Vercel } from '@vercel/sdk'
import type { BundledFile } from '../mcp/bundle'

// Capture native fetch at module load time before Vercel Workflow DevKit can
// intercept globalThis.fetch inside 'use step' functions.
const _fetch = globalThis.fetch

export interface MonorepoInfo {
  repoOwner: string
  repoName: string
  defaultBranch: string
}

export interface GitHubPRResult {
  prUrl: string
  prTitle: string
  prNumber: number
  repoUrl: string
  repoOwner: string
  repoName: string
  defaultBranch: string
  githubWebhookId: number
}

export interface VercelProjectResult {
  vercelProjectId: string
  setupLogs: string[]
}

export interface VercelDeployResult {
  vercelProjectId: string
  deploymentId: string
  mcpUrl: string
  buildLogs: string[]
}

const MONOREPO_NAME = 'generated-mcps'
const VERCEL_BUILD_TIMEOUT_MS = 10 * 60 * 1000
const DEPLOY_APPEAR_TIMEOUT_MS = 5 * 60 * 1000  // max wait for Vercel to queue the first deployment
const DEPLOY_POLL_INTERVAL_MS = 20_000           // how often to check
const VERCEL_API = 'https://api.vercel.com'

interface SharedEnvVar {
  id: string
  key: string
  projectId: string[]
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
    { key: 'HMAC_SECRET', value: hmacSecret },
    { key: 'CREDENTIAL_ENDPOINT', value: credentialEndpoint },
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
        const body = (await res.json()) as unknown
        throw new Error(`Failed to create shared env var ${key}: ${JSON.stringify(body)}`)
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
    const body = (await res.json()) as unknown
    throw new Error(`Failed to inject env var ${key}: ${JSON.stringify(body)}`)
  }
}

export function getOctokit() {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is not set')
  return new Octokit({ auth: token })
}


function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/**
 * Ensure the generated-mcps monorepo exists. Idempotent — returns existing repo if already created.
 */
export async function ensureMonorepo(): Promise<MonorepoInfo> {
  const octokit = getOctokit()

  // Get the authenticated user login
  const { data: user } = await octokit.users.getAuthenticated()
  const owner = user.login

  try {
    const { data: repo } = await octokit.repos.get({ owner, repo: MONOREPO_NAME })
    return {
      repoOwner: owner,
      repoName: MONOREPO_NAME,
      defaultBranch: repo.default_branch,
    }
  } catch (err: unknown) {
    const status = (err as { status?: number }).status
    if (status !== 404) throw err
  }

  // Create the monorepo
  const { data: repo } = await octokit.repos.createForAuthenticatedUser({
    name: MONOREPO_NAME,
    description: 'Auto-generated MCP servers',
    auto_init: true,
    // Default private — set GITHUB_REPO_PRIVATE=false to override (e.g. for public demos)
    private: process.env.GITHUB_REPO_PRIVATE !== 'false',
  })

  // Give GitHub a moment to initialise the default branch
  await sleep(1500)

  return {
    repoOwner: owner,
    repoName: MONOREPO_NAME,
    defaultBranch: repo.default_branch,
  }
}

/**
 * Push the MCP bundle files as a PR branch and open a pull request.
 * Files land under mcps/{integrationId}/ in the monorepo.
 */
export async function createGitHubPR(
  integrationName: string,
  integrationId: string,
  files: BundledFile[],
  monorepo: MonorepoInfo,
  webhookUrl: string,
): Promise<GitHubPRResult> {
  const octokit = getOctokit()
  const { repoOwner, repoName, defaultBranch } = monorepo
  const branch = `generate/${integrationId.slice(0, 8)}`

  // Get current HEAD of default branch
  const { data: ref } = await octokit.git.getRef({
    owner: repoOwner,
    repo: repoName,
    ref: `heads/${defaultBranch}`,
  })
  const baseSha = ref.object.sha

  // Delete branch from any previous attempt so createRef always succeeds.
  // Deleting auto-closes any open PR for the branch.
  try {
    await octokit.git.deleteRef({
      owner: repoOwner,
      repo: repoName,
      ref: `heads/${branch}`,
    })
  } catch (err: unknown) {
    const status = (err as { status?: number }).status
    if (status !== 404 && status !== 422) throw err
  }

  // Create branch
  await octokit.git.createRef({
    owner: repoOwner,
    repo: repoName,
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  })

  // Push all files as a single atomic commit via the Git Trees API.
  // This avoids the SHA requirement of createOrUpdateFileContents when files already
  // exist on the branch (e.g. on a retry after a previous run was merged).

  // 1. Create a blob for each file
  const blobs = await Promise.all(
    files.map((f) =>
      octokit.git.createBlob({
        owner: repoOwner,
        repo: repoName,
        content: Buffer.from(f.data).toString('base64'),
        encoding: 'base64',
      }),
    ),
  )

  // 2. Create a tree referencing the new blobs
  const { data: tree } = await octokit.git.createTree({
    owner: repoOwner,
    repo: repoName,
    base_tree: baseSha,
    tree: files.map((f, i) => ({
      path: `mcps/${integrationId}/${f.file}`,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: blobs[i].data.sha,
    })),
  })

  // 3. Create a commit
  const { data: commit } = await octokit.git.createCommit({
    owner: repoOwner,
    repo: repoName,
    message: `chore: add generated MCP server for ${integrationName}`,
    tree: tree.sha,
    parents: [baseSha],
  })

  // 4. Point the branch at the new commit
  await octokit.git.updateRef({
    owner: repoOwner,
    repo: repoName,
    ref: `heads/${branch}`,
    sha: commit.sha,
  })

  const prTitle = `Add MCP: ${integrationName}`
  const prBody = [
    `This PR adds a generated MCP server for **${integrationName}**.`,
    '',
    'Review the tool definitions and API mappings below before merging. Merging this PR will automatically trigger a Vercel deployment.',
    '',
    `**Integration ID:** \`${integrationId}\``,
    `**Path:** \`mcps/${integrationId}/\``,
  ].join('\n')

  const { data: pr } = await octokit.pulls.create({
    owner: repoOwner,
    repo: repoName,
    title: prTitle,
    body: prBody,
    head: branch,
    base: defaultBranch,
  })

  // Register a GitHub webhook so the Workflow can resume when the PR is merged.
  // In local dev the webhook URL is localhost which GitHub rejects — skip registration
  // and fall back to polling in that case (githubWebhookId: 0 signals the caller).
  const isLocalUrl =
    webhookUrl.startsWith('http://localhost') || webhookUrl.startsWith('http://127.')
  let githubWebhookId = 0
  if (!isLocalUrl) {
    const { data: hook } = await octokit.repos.createWebhook({
      owner: repoOwner,
      repo: repoName,
      config: { url: webhookUrl, content_type: 'json' },
      events: ['pull_request'],
      active: true,
    })
    githubWebhookId = hook.id
  }

  return {
    prUrl: pr.html_url,
    prTitle,
    prNumber: pr.number,
    repoUrl: `https://github.com/${repoOwner}/${repoName}`,
    repoOwner,
    repoName,
    defaultBranch,
    githubWebhookId,
  }
}

/**
 * Remove the per-run GitHub webhook after the PR is merged or closed.
 */
export async function deleteGitHubWebhook(owner: string, repo: string, webhookId: number): Promise<void> {
  const octokit = getOctokit()
  await octokit.repos.deleteWebhook({ owner, repo, hook_id: webhookId })
}

/**
 * Create a Vercel project linked to the monorepo subdirectory and inject env vars.
 * Idempotent — reuses the existing project if a retry occurs.
 */
export async function createVercelProject(
  monorepo: MonorepoInfo,
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
    await injectProjectEnvVar(projectId, 'INTEGRATION_ID', integrationId, token, teamId)
    logs.push(`Environment variables set.`)
  }

  return { vercelProjectId: projectId, setupLogs: logs }
}

/**
 * Wait for the first Vercel deployment on a project to reach READY or ERROR.
 * Separated from createVercelProject so WDK can retry the poll without re-creating the project.
 */
export async function pollVercelDeployment(vercelProjectId: string): Promise<VercelDeployResult> {
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN is not set')
  const vercel = new Vercel({ bearerToken: token })
  const teamId = process.env.VERCEL_TEAM_ID
  const logs: string[] = []

  // Poll until Vercel queues the first deployment (can take several minutes for a new project)
  logs.push(`Waiting for Vercel to queue a deployment...`)
  const appearDeadline = Date.now() + DEPLOY_APPEAR_TIMEOUT_MS
  let firstDeployments: Awaited<ReturnType<typeof vercel.deployments.getDeployments>>['deployments'] = []
  while (firstDeployments.length === 0) {
    if (Date.now() > appearDeadline) {
      throw new Error('No deployment appeared within 5 minutes — check the Vercel dashboard.')
    }
    await sleep(DEPLOY_POLL_INTERVAL_MS)
    const resp = await vercel.deployments.getDeployments({
      projectId: vercelProjectId,
      limit: 1,
      ...(teamId ? { teamId } : {}),
    })
    firstDeployments = resp.deployments ?? []
  }

  let dep = firstDeployments[0]
  logs.push(`Deployment found: ${dep.uid} (state: ${dep.readyState ?? 'unknown'})`)

  const buildStart = Date.now()

  while (dep.readyState !== 'READY' && dep.readyState !== 'ERROR') {
    if (Date.now() - buildStart > VERCEL_BUILD_TIMEOUT_MS) {
      throw new Error('Vercel deployment timed out after 10 minutes.')
    }

    await sleep(5_000)

    const refreshed = await vercel.deployments.getDeployment({
      idOrUrl: dep.uid,
      ...(teamId ? { teamId } : {}),
    })

    const state = refreshed.readyState ?? 'BUILDING'
    logs.push(`Building... (${state})`)
    dep = { ...dep, readyState: state as typeof dep.readyState, url: refreshed.url ?? dep.url }
  }

  if (dep.readyState === 'ERROR') {
    throw new Error('Vercel deployment failed — check the Vercel dashboard for build logs.')
  }

  logs.push(`✓ Deployment READY`)

  return {
    vercelProjectId,
    deploymentId: dep.uid,
    mcpUrl: `https://${dep.url}`,
    buildLogs: logs,
  }
}
