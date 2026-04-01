import { Octokit } from '@octokit/rest'
import { Vercel } from '@vercel/sdk'
import type { BundledFile } from '../mcp/bundle'

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

export interface VercelDeployResult {
  vercelProjectId: string
  deploymentId: string
  mcpUrl: string
  buildLogs: string[]
}

const MONOREPO_NAME = 'generated-mcps'
const VERCEL_BUILD_TIMEOUT_MS = 10 * 60 * 1000

function getOctokit() {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is not set')
  return new Octokit({ auth: token })
}

function getVercel() {
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN is not set')
  return new Vercel({ bearerToken: token })
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

  // Push all files in parallel — each under mcps/{integrationId}/
  await Promise.all(
    files.map((f) =>
      octokit.repos.createOrUpdateFileContents({
        owner: repoOwner,
        repo: repoName,
        path: `mcps/${integrationId}/${f.file}`,
        message: `chore: add generated MCP server for ${integrationName}`,
        content: Buffer.from(f.data).toString('base64'),
        branch,
      }),
    ),
  )

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

  // Register a GitHub webhook so the Workflow can resume when the PR is merged
  const { data: hook } = await octokit.repos.createWebhook({
    owner: repoOwner,
    repo: repoName,
    config: { url: webhookUrl, content_type: 'json' },
    events: ['pull_request'],
    active: true,
  })

  return {
    prUrl: pr.html_url,
    prTitle,
    prNumber: pr.number,
    repoUrl: `https://github.com/${repoOwner}/${repoName}`,
    repoOwner,
    repoName,
    defaultBranch,
    githubWebhookId: hook.id,
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
 * Create a Vercel project linked to the monorepo, scoped to the integration's subdirectory,
 * and wait for the initial deployment to reach READY.
 */
export async function createVercelProject(
  monorepo: MonorepoInfo,
  integrationId: string,
  integrationName: string,
): Promise<VercelDeployResult> {
  const vercel = getVercel()
  const teamId = process.env.VERCEL_TEAM_ID
  const projectName = `mcp-${sanitize(integrationName)}-${integrationId.slice(0, 6)}`
  const rootDirectory = `mcps/${integrationId}`
  const logs: string[] = []

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
    },
  })

  logs.push(`Project created (id: ${project.id}) — waiting for Vercel to start building...`)

  // Give Vercel time to detect the linked repo and queue a deployment
  await sleep(30_000)

  // Find the initial deployment
  const deploymentsResp = await vercel.deployments.getDeployments({
    projectId: project.id,
    limit: 1,
    ...(teamId ? { teamId } : {}),
  })

  const deployments = deploymentsResp.deployments ?? []
  if (deployments.length === 0) {
    throw new Error('No deployment found after project creation — Vercel may still be setting up the repo link.')
  }

  let dep = deployments[0]
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
    vercelProjectId: project.id,
    deploymentId: dep.uid,
    mcpUrl: `https://${dep.url}`,
    buildLogs: logs,
  }
}
