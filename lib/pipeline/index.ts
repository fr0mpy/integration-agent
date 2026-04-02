import { getWritable, createWebhook, createHook, sleep, fetch as wfFetch } from 'workflow'
import { neonConfig } from '@neondatabase/serverless'
import { createEvent, type PipelineEvent, type ValidateEventData, type DeployEventData, type AuditEventData } from './events'
import type { DiscoveryResult } from './discover'
import type { MCPServerConfig } from '../mcp/types'
import type { SandboxResult } from './sandbox-check'
import type { AuditResult } from './security-audit'
import type { GitHubPRResult, MonorepoInfo, VercelDeployResult, VercelProjectResult, DeploymentInfo } from './deploy'
import { config as appConfig } from '../config'

// WDK intercepts globalThis.fetch inside 'use step' / 'use workflow' functions and throws
// if code tries to use it directly. Fix: configure Neon to use WDK's fetch, the officially
// supported approach (https://useworkflow.dev/err/fetch-in-workflow).
neonConfig.fetchFunction = wfFetch

// deploy.ts only reaches the module cache via dynamic imports inside step functions —
// by the time those run, WDK has replaced globalThis.fetch with an error-throwing sentinel.
// Force a static load here so deploy.ts's `const _fetch = globalThis.fetch` captures the
// real fetch before any step executes.
import './deploy'

async function emitEvent(event: PipelineEvent) {
  'use step'
  const writable = getWritable<PipelineEvent>()
  const writer = writable.getWriter()
  await writer.write(event)
  writer.releaseLock()
}

async function checkDiscoveryCache(specHash: string): Promise<DiscoveryResult | null> {
  'use step'
  const { discoveryCache } = await import('../storage/redis')
  return (await discoveryCache.get(specHash)) as DiscoveryResult | null
}

async function runDiscovery(spec: Record<string, unknown>): Promise<DiscoveryResult> {
  'use step'
  const { discoverEndpoints, enrichDiscovery } = await import('./discover')
  const raw = await discoverEndpoints(spec)
  return enrichDiscovery(raw)
}

async function runSynthesis(discovered: DiscoveryResult): Promise<MCPServerConfig> {
  'use step'
  const { synthesiseTools } = await import('./synthesise')
  return synthesiseTools(discovered)
}

async function runSynthesisWithBuildErrors(
  discovered: DiscoveryResult,
  buildErrors: string,
): Promise<MCPServerConfig> {
  'use step'
  const { synthesiseTools } = await import('./synthesise')
  return synthesiseTools(discovered, buildErrors)
}

async function loadSourceOverride(integrationId: string): Promise<string | null> {
  'use step'
  const { sourceOverride } = await import('../storage/redis')
  return sourceOverride.get(integrationId)
}

async function runCodegen(config: MCPServerConfig): Promise<{ files: Array<{ file: string; data: string }>; sourceCode: string }> {
  'use step'
  const { bundleServer } = await import('../mcp/bundle')
  return bundleServer(config)
}

async function runValidateSandbox(
  bundle: { files: Array<{ file: string; data: string }>; sourceCode: string },
  config: MCPServerConfig,
) {
  'use step'
  const { runSandboxCheck } = await import('./sandbox-check')
  return runSandboxCheck(bundle, config)
}

async function cacheResults(specHash: string, specUrl: string, config: MCPServerConfig, discovered: DiscoveryResult) {
  'use step'
  const { configCache, urlCache, discoveryCache } = await import('../storage/redis')
  await configCache.set(specHash, config)
  await urlCache.setHash(specUrl, specHash)
  await discoveryCache.set(specHash, discovered)
}

async function setIntegrationStatus(integrationId: string, status: string) {
  'use step'
  const { updateIntegration } = await import('../storage/neon')
  await updateIntegration(integrationId, { status })
}

async function persistValidation(integrationId: string, result: SandboxResult) {
  'use step'
  const { updateIntegration } = await import('../storage/neon')
  await updateIntegration(integrationId, {
    sandbox_id: result.sandboxId,
    sandbox_url: result.sandboxUrl,
    verified_tools: result.verifiedTools,
    validated_at: new Date().toISOString(),
  })
}

async function failIntegration(integrationId: string) {
  'use step'
  const { updateIntegration, INTEGRATION_STATUS } = await import('../storage/neon')
  await updateIntegration(integrationId, { status: INTEGRATION_STATUS.FAILED })
}

async function runEnsureMonorepo(): Promise<MonorepoInfo> {
  'use step'
  const { ensureMonorepo } = await import('./deploy')
  return ensureMonorepo()
}

async function runCreateGitHubPR(
  integrationName: string,
  integrationId: string,
  files: Array<{ file: string; data: string }>,
  monorepo: MonorepoInfo,
  webhookUrl: string,
): Promise<GitHubPRResult> {
  'use step'
  const { createGitHubPR } = await import('./deploy')
  return createGitHubPR(integrationName, integrationId, files, monorepo, webhookUrl)
}

async function checkPRStatus(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ state: string; merged: boolean }> {
  'use step'
  const { getOctokit } = await import('./deploy')
  const octokit = getOctokit()
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber })
  return { state: pr.state as string, merged: !!pr.merged }
}

async function runDeleteGitHubWebhook(owner: string, repo: string, webhookId: number): Promise<void> {
  'use step'
  const { deleteGitHubWebhook } = await import('./deploy')
  await deleteGitHubWebhook(owner, repo, webhookId)
}

async function persistPRInfo(integrationId: string, prResult: GitHubPRResult): Promise<void> {
  'use step'
  const { updateIntegration } = await import('../storage/neon')
  await updateIntegration(integrationId, {
    github_repo_url: prResult.repoUrl,
    github_pr_url: prResult.prUrl,
    github_repo_name: prResult.repoName,
  })
}

async function runCreateVercelProject(
  monorepo: MonorepoInfo,
  integrationId: string,
  integrationName: string,
): Promise<VercelProjectResult> {
  'use step'
  const { createVercelProject } = await import('./deploy')
  return createVercelProject(monorepo, integrationId, integrationName)
}

async function runFindDeployment(vercelProjectId: string): Promise<DeploymentInfo | null> {
  'use step'
  const { findDeployment } = await import('./deploy')
  return findDeployment(vercelProjectId)
}

async function runCheckDeploymentStatus(deploymentUid: string): Promise<DeploymentInfo> {
  'use step'
  const { checkDeploymentStatus } = await import('./deploy')
  return checkDeploymentStatus(deploymentUid)
}

async function persistDeployment(
  integrationId: string,
  prResult: GitHubPRResult,
  vercelResult: VercelDeployResult,
) {
  'use step'
  const { updateIntegration, INTEGRATION_STATUS } = await import('../storage/neon')
  await updateIntegration(integrationId, {
    status: INTEGRATION_STATUS.LIVE,
    mcp_url: vercelResult.mcpUrl,
    deployment_id: vercelResult.deploymentId,
    github_repo_url: prResult.repoUrl,
    github_pr_url: prResult.prUrl,
    github_repo_name: prResult.repoName,
  })
}

async function runSecurityAudit(
  config: MCPServerConfig,
  discovered: DiscoveryResult,
  sourceCode: string,
): Promise<AuditResult> {
  'use step'
  const { performSecurityAudit } = await import('./security-audit')
  return performSecurityAudit(config, discovered, sourceCode)
}

/**
 * Durable synthesis pipeline.
 * Stages: Discover → Synthesise → Validate (live MCP test) → Audit → Deploy
 */
export async function synthesisePipeline(
  integrationId: string,
  spec: Record<string, unknown>,
  specHash: string,
  specUrl: string,
) {
  'use workflow'

  // Track which stage is active so the catch block emits the correct failed event
  let currentStage: 'discover-api' | 'build-mcp' | 'preview-mcp' | 'audit-mcp' | 'deploy-mcp' = 'discover-api'

  try {
    // Stage 1: Discovery + Enrichment
    // Fast path: skip AI enrichment call if we've already processed this spec before
    await emitEvent(createEvent('discover-api', 'running'))
    const cachedDiscovery = await checkDiscoveryCache(specHash)
    const discovered = cachedDiscovery ?? await runDiscovery(spec)
    await emitEvent(createEvent('discover-api', 'complete', discovered))

    await setIntegrationStatus(integrationId, 'synthesising')

    // Stage 2: Synthesis
    currentStage = 'build-mcp'
    await emitEvent(createEvent('build-mcp', 'running'))
    let config = await runSynthesis(discovered)

    for (const tool of config.tools) {
      await emitEvent(createEvent('build-mcp', 'tool_complete', tool))
    }

    await emitEvent(createEvent('build-mcp', 'complete', config))

    // ─── Pause: Wait for user to review tools and trigger build ───────────────
    await emitEvent(createEvent('build-mcp', 'awaiting-trigger'))

    using buildHook = createHook<{ excludedTools: string[] }>({
      token: `build-trigger:${integrationId}`,
    })
    const buildPayload = await buildHook

    // Filter out tools the user toggled off
    if (buildPayload.excludedTools.length > 0) {
      const excluded = new Set(buildPayload.excludedTools)
      config = {
        ...config,
        tools: config.tools.filter((t) => !excluded.has(t.name)),
      }
    }

    // Silent structural pre-flight — not a visible stage
    const { validateConfig } = await import('./validate')
    const structural = validateConfig(config, discovered)

    if (!structural.valid) {
      const errorMsg = structural.errors.map((e) => `${e.tool}: ${e.message}`).join('; ')
      await emitEvent(createEvent('preview-mcp', 'failed', { errors: errorMsg } satisfies ValidateEventData))
      await failIntegration(integrationId)
      await emitEvent(createEvent('preview-mcp', 'done'))
      return config
    }

    // Codegen
    currentStage = 'preview-mcp'
    let bundle = await runCodegen(config)

    // Stage 3: Validate — build + start + live MCP test
    await emitEvent(createEvent('preview-mcp', 'running', { sourceCode: bundle.sourceCode } satisfies ValidateEventData))
    await setIntegrationStatus(integrationId, 'validating')

    let sandboxResult = await runValidateSandbox(bundle, config)

    for (const log of sandboxResult.buildLogs) {
      await emitEvent(createEvent('preview-mcp', 'building', { buildLog: log } satisfies ValidateEventData))
    }

    // Sandbox build failed — retry synthesis once with build errors as context
    if (!sandboxResult.ok && sandboxResult.errors) {
      await emitEvent(createEvent('preview-mcp', 'retrying', { errors: sandboxResult.errors } satisfies ValidateEventData))
      currentStage = 'build-mcp'
      await emitEvent(createEvent('build-mcp', 'running'))
      config = await runSynthesisWithBuildErrors(discovered, sandboxResult.errors)

      for (const tool of config.tools) {
        await emitEvent(createEvent('build-mcp', 'tool_complete', tool))
      }

      await emitEvent(createEvent('build-mcp', 'complete', config))

      currentStage = 'preview-mcp'
      bundle = await runCodegen(config)
      await emitEvent(createEvent('preview-mcp', 'running', { sourceCode: bundle.sourceCode } satisfies ValidateEventData))

      sandboxResult = await runValidateSandbox(bundle, config)

      for (const log of sandboxResult.buildLogs) {
        await emitEvent(createEvent('preview-mcp', 'building', { buildLog: log } satisfies ValidateEventData))
      }
    }

    if (!sandboxResult.ok) {
      await emitEvent(createEvent('preview-mcp', 'failed', { error: sandboxResult.errors ?? 'Sandbox build failed' }))
      await failIntegration(integrationId)
      await emitEvent(createEvent('preview-mcp', 'done'))
      return config
    }

    await emitEvent(createEvent('preview-mcp', 'complete', {
      verifiedTools: sandboxResult.verifiedTools,
      toolCount: sandboxResult.verifiedTools.length,
      sandboxUrl: sandboxResult.sandboxUrl,
      sandboxId: sandboxResult.sandboxId,
    } satisfies ValidateEventData))

    // Persist validation proof to Neon
    await persistValidation(integrationId, sandboxResult)

    // Cache results only after validation passes
    await cacheResults(specHash, specUrl, config, discovered)

    await emitEvent(createEvent('preview-mcp', 'done'))

    // ─── Pause: Wait for manual trigger (iterable — allows re-runs) ─────────
    await emitEvent(createEvent('audit-mcp', 'awaiting-trigger'))

    using auditHook = createHook<{ triggered: boolean }>({
      token: `audit-trigger:${integrationId}`,
    })

    for await (const _trigger of auditHook) {
      // Apply user edits (if any) before each audit run
      const editedSource = await loadSourceOverride(integrationId)

      if (editedSource) {
        bundle = {
          ...bundle,
          sourceCode: editedSource,
          files: bundle.files.map(f =>
            f.file === 'app/[transport]/route.ts' ? { ...f, data: editedSource } : f
          ),
        }
      }

      // ─── Stage 3.5: Security Audit ─────────────────────────────────────────
      currentStage = 'audit-mcp'
      await emitEvent(createEvent('audit-mcp', 'running'))

      const auditResult = await runSecurityAudit(config, discovered, bundle.sourceCode)

      for (const auditFinding of auditResult.findings) {
        await emitEvent(createEvent('audit-mcp', 'finding', { finding: auditFinding } satisfies AuditEventData))
      }

      const auditStatus = auditResult.passed ? 'complete' : 'failed'
      await emitEvent(createEvent('audit-mcp', auditStatus, {
        summary: auditResult.summary,
        blocked: !auditResult.passed,
      } satisfies AuditEventData))

      if (auditResult.passed) break

      // Audit failed — wait for user to re-trigger
      await emitEvent(createEvent('audit-mcp', 'awaiting-trigger'))
    }

    // ─── Stage 4: Deploy MCP ─────────────────────────────────────────────────
    currentStage = 'deploy-mcp'
    await emitEvent(createEvent('deploy-mcp', 'running', { step: 'create-repo' } satisfies DeployEventData))
    await setIntegrationStatus(integrationId, 'deploying')

    const monorepo = await runEnsureMonorepo()

    await emitEvent(createEvent('deploy-mcp', 'running', { step: 'push-files', repoName: monorepo.repoName } satisfies DeployEventData))

    // Create a Workflow webhook — GitHub will POST to this URL when the PR is merged,
    // suspending the workflow durably instead of polling.
    using prWebhook = createWebhook({ respondWith: Response.json({ ok: true }) })

    const prResult = await runCreateGitHubPR(discovered.apiName, integrationId, bundle.files, monorepo, prWebhook.url)

    // Persist PR info immediately so the UI can show the link even if the user refreshes
    await persistPRInfo(integrationId, prResult)

    await emitEvent(createEvent('deploy-mcp', 'running', {
      step: 'pr-open',
      prUrl: prResult.prUrl,
      prTitle: prResult.prTitle,
      repoUrl: prResult.repoUrl,
      repoName: prResult.repoName,
      prStatus: 'open',
    } satisfies DeployEventData))

    await emitEvent(createEvent('deploy-mcp', 'running', {
      step: 'await-merge',
      prUrl: prResult.prUrl,
      prStatus: 'open',
      waitMessage: 'Waiting for PR to be merged...',
    } satisfies DeployEventData))

    // Wait for the PR to be merged.
    // In prod: suspend durably via GitHub webhook (event-driven).
    // In dev: GitHub rejects localhost webhook URLs, so poll the API every 30s instead.
    const isLocalDev = appConfig.deploy.localUrlPrefixes.some((p) => prWebhook.url.startsWith(p))

    let mergeResult = { merged: false, closedWithoutMerge: false }

    if (isLocalDev) {
      const POLL_DEADLINE_MS = 24 * 60 * 60 * 1000
      const pollStart = Date.now()

      while (Date.now() - pollStart < POLL_DEADLINE_MS) {
        const prStatus = await checkPRStatus(prResult.repoOwner, prResult.repoName, prResult.prNumber)

        if (prStatus.state === 'closed') {
          mergeResult = { merged: prStatus.merged, closedWithoutMerge: !prStatus.merged }
          break
        }

        await sleep('30s')
      }
    } else {
      type GHPREvent = { action?: string; pull_request?: { number: number; merged: boolean } }

      for await (const ghRequest of prWebhook) {
        const body = await ghRequest.json() as GHPREvent
        if (body.pull_request?.number !== prResult.prNumber) continue

        if (body.action === 'closed' && body.pull_request?.merged === true) {
          mergeResult = { merged: true, closedWithoutMerge: false }
          break
        }

        if (body.action === 'closed') {
          mergeResult = { merged: false, closedWithoutMerge: true }
          break
        }
      }

      await runDeleteGitHubWebhook(prResult.repoOwner, prResult.repoName, prResult.githubWebhookId)
    }

    if (!mergeResult.merged) {
      const reason = mergeResult.closedWithoutMerge
        ? 'PR was closed without merging.'
        : 'Timed out waiting for PR merge (24h limit).'
      await emitEvent(createEvent('deploy-mcp', 'failed', { error: reason } satisfies DeployEventData))
      await failIntegration(integrationId)
      await emitEvent(createEvent('deploy-mcp', 'done'))
      return config
    }

    await emitEvent(createEvent('deploy-mcp', 'running', {
      step: 'merged',
      prUrl: prResult.prUrl,
      prStatus: 'merged',
    } satisfies DeployEventData))

    await emitEvent(createEvent('deploy-mcp', 'running', {
      step: 'deploying',
    } satisfies DeployEventData))

    const projectResult = await runCreateVercelProject(monorepo, integrationId, discovered.apiName)

    for (const line of projectResult.setupLogs) {
      await emitEvent(createEvent('deploy-mcp', 'building', { buildLog: line } satisfies DeployEventData))
    }

    // Poll for deployment to appear — emit progress events each iteration to keep SSE alive
    await emitEvent(createEvent('deploy-mcp', 'building', { buildLog: 'Waiting for Vercel to queue a deployment...' } satisfies DeployEventData))
    const APPEAR_TIMEOUT_MS = 5 * 60 * 1000
    const APPEAR_POLL_MS = 20_000
    const appearDeadline = Date.now() + APPEAR_TIMEOUT_MS
    let deployment: DeploymentInfo | null = null

    while (!deployment) {
      if (Date.now() > appearDeadline) {
        throw new Error('No deployment appeared within 5 minutes — check the Vercel dashboard.')
      }
      await sleep(APPEAR_POLL_MS)
      deployment = await runFindDeployment(projectResult.vercelProjectId)
      if (!deployment) {
        await emitEvent(createEvent('deploy-mcp', 'building', { buildLog: 'Still waiting for deployment...' } satisfies DeployEventData))
      }
    }

    await emitEvent(createEvent('deploy-mcp', 'building', { buildLog: `Deployment found: ${deployment.uid} (state: ${deployment.readyState})` } satisfies DeployEventData))

    // Poll until deployment reaches READY or ERROR — emit status each iteration
    const BUILD_TIMEOUT_MS = 10 * 60 * 1000
    const buildDeadline = Date.now() + BUILD_TIMEOUT_MS

    while (deployment.readyState !== 'READY' && deployment.readyState !== 'ERROR') {
      if (Date.now() > buildDeadline) {
        throw new Error('Vercel deployment timed out after 10 minutes.')
      }
      await sleep(5_000)
      deployment = await runCheckDeploymentStatus(deployment.uid)
      await emitEvent(createEvent('deploy-mcp', 'building', { buildLog: `Building... (${deployment.readyState})` } satisfies DeployEventData))
    }

    if (deployment.readyState === 'ERROR') {
      throw new Error('Vercel deployment failed — check the Vercel dashboard for build logs.')
    }

    await emitEvent(createEvent('deploy-mcp', 'building', { buildLog: '✓ Deployment READY' } satisfies DeployEventData))

    const vercelResult: VercelDeployResult = {
      vercelProjectId: projectResult.vercelProjectId,
      deploymentId: deployment.uid,
      mcpUrl: `https://${deployment.url}`,
      buildLogs: [],
    }

    await persistDeployment(integrationId, prResult, vercelResult)

    await emitEvent(createEvent('deploy-mcp', 'complete', {
      step: 'live',
      mcpUrl: vercelResult.mcpUrl,
      deploymentId: vercelResult.deploymentId,
      prUrl: prResult.prUrl,
      repoUrl: prResult.repoUrl,
    } satisfies DeployEventData))

    await emitEvent(createEvent('deploy-mcp', 'done'))

    return config
  } catch (err) {
    console.error('Pipeline error:', err instanceof Error ? err.message : 'unknown')
    await emitEvent(createEvent(currentStage, 'failed', { error: 'Pipeline failed. Please try again.' }))
    await failIntegration(integrationId)
    await emitEvent(createEvent(currentStage, 'done'))
    throw err
  }
}
