import { Octokit } from '@octokit/rest'
import type { BundledFile } from '../../mcp/bundle'
import { config } from '../../config'

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

const MONOREPO_NAME = 'generated-mcps'

// Returns an authenticated Octokit REST client; throws immediately if GITHUB_TOKEN is not set.
export function getOctokit() {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is not set')
  return new Octokit({ auth: token })
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
  const isLocalUrl = config.deploy.localUrlPrefixes.some((p) => webhookUrl.startsWith(p))
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
