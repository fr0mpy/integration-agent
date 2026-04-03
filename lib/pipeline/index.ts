import {
  getWritable,
  createWebhook,
  createHook,
  sleep,
  fetch as wfFetch,
} from 'workflow';
import { revalidateTag } from 'next/cache';
import { neonConfig } from '@neondatabase/serverless';
import {
  createEvent,
  type PipelineEvent,
  type ValidateEventData,
  type DeployEventData,
  type AuditEventData,
} from './events';
import type { DiscoveryResult } from './discover';
import type { MCPServerConfig } from '../mcp/types';
import type { SandboxResult } from './sandbox-check';
import type { AuditResult } from './security-audit';
import type {
  GitHubPRResult,
  MonorepoInfo,
  VercelDeployResult,
  VercelProjectResult,
  DeploymentInfo,
} from './deploy';
import { config as appConfig } from '../config';

// WDK intercepts globalThis.fetch inside 'use step' / 'use workflow' functions and throws
// if code tries to use it directly. Fix: configure Neon to use WDK's fetch, the officially
// supported approach (https://useworkflow.dev/err/fetch-in-workflow).
neonConfig.fetchFunction = wfFetch;

// deploy.ts only reaches the module cache via dynamic imports inside step functions —
// by the time those run, WDK has replaced globalThis.fetch with an error-throwing sentinel.
// Force a static load here so deploy.ts's `const _fetch = globalThis.fetch` captures the
// real fetch before any step executes.
import './deploy';

// Writes a single typed event to the WDK SSE stream; every stage progress update the UI sees goes through here.
async function emitEvent(event: PipelineEvent) {
  'use step';
  const writable = getWritable<PipelineEvent>();
  const writer = writable.getWriter();
  await writer.write(event);
  writer.releaseLock();
}

// Returns a cached DiscoveryResult for this spec hash if one exists; skips re-scraping the same URL on retries.
async function checkDiscoveryCache(
  specHash: string,
): Promise<DiscoveryResult | null> {
  'use step';
  const { discoveryCache } = await import('../storage/redis');
  return (await discoveryCache.get(specHash)) as DiscoveryResult | null;
}

// Parses the OpenAPI spec and optionally enriches the endpoint list via AI; produces the structured input for synthesis.
async function runDiscovery(
  spec: Record<string, unknown>,
  specUrl: string,
): Promise<DiscoveryResult> {
  'use step';
  const { discoverEndpoints, enrichDiscovery } = await import('./discover');
  const raw = await discoverEndpoints(spec, specUrl);
  return enrichDiscovery(raw);
}

// Calls the synthesis LLM to convert discovered endpoints into MCP tool definitions; first attempt with no prior error context.
async function runSynthesis(
  discovered: DiscoveryResult,
): Promise<MCPServerConfig> {
  'use step';
  const { synthesiseTools } = await import('./synthesise');
  return synthesiseTools(discovered);
}

// Retries synthesis with sandbox build errors injected into the prompt; called when the first codegen pass produces uncompilable TypeScript.
async function runSynthesisWithBuildErrors(
  discovered: DiscoveryResult,
  buildErrors: string,
): Promise<MCPServerConfig> {
  'use step';
  const { synthesiseTools } = await import('./synthesise');
  return synthesiseTools(discovered, buildErrors);
}

// Fetches a user-edited source file from Redis if one exists; applied before each re-audit so manual edits are picked up.
async function loadSourceOverride(
  integrationId: string,
): Promise<string | null> {
  'use step';
  const { sourceOverride } = await import('../storage/redis');
  return sourceOverride.get(integrationId);
}

// Deletes the source override after it has been consumed; prevents stale edits from re-applying on future re-audit triggers.
async function clearSourceOverride(integrationId: string): Promise<void> {
  'use step';
  const { sourceOverride } = await import('../storage/redis');
  await sourceOverride.del(integrationId);
}

// Bundles the MCP config into deployable Next.js files; produces the file set written to the sandbox and later pushed to GitHub.
async function runCodegen(config: MCPServerConfig): Promise<{
  files: Array<{ file: string; data: string }>;
  sourceCode: string;
}> {
  'use step';
  const { bundleServer } = await import('../mcp/bundle');
  return bundleServer(config);
}

// Boots a Vercel Sandbox, builds and starts the MCP server, and verifies all tool names via a live MCP client call.
async function runValidateSandbox(
  bundle: { files: Array<{ file: string; data: string }>; sourceCode: string },
  config: MCPServerConfig,
) {
  'use step';
  const { runSandboxCheck } = await import('./sandbox-check');
  return runSandboxCheck(bundle, config);
}

// Writes discovery result to Redis immediately after discovery runs; safe to cache before sandbox since it's deterministic.
async function cacheDiscovery(specHash: string, discovered: DiscoveryResult) {
  'use step';
  const { discoveryCache } = await import('../storage/redis');
  await discoveryCache.set(specHash, discovered);
}

// Writes the full unfiltered MCP config to Redis before the build hook fires.
// Stores all tools so cached config is never locked to a prior exclusion choice.
async function cacheMcpConfig(specHash: string, config: MCPServerConfig) {
  'use step';
  const { BUILD_VERSION } = await import('../config');
  console.log(`[v${BUILD_VERSION}] pipeline.cacheMcpConfig: specHash=${specHash.slice(0, 12)} toolCount=${config.tools.length}`);
  const { mcpConfigCache } = await import('../storage/redis');
  const result = await mcpConfigCache.set(specHash, config);
  console.log(`[v${BUILD_VERSION}] pipeline.cacheMcpConfig: result=${result}`);
  if (result === null) {
    throw new Error(`Failed to cache MCP config for specHash=${specHash.slice(0, 8)} — Redis write returned null`);
  }
}

// Writes the URL→hash index after sandbox validation passes; acts as the commit signal for the fast path.
async function commitSpecUrlIndex(specHash: string, specUrl: string) {
  'use step';
  const { specUrlIndex } = await import('../storage/redis');
  await specUrlIndex.setHash(specUrl, specHash);
}

// Updates the integration row's status column in Postgres; drives the status badge in the UI.
async function setIntegrationStatus(integrationId: string, status: string) {
  'use step';
  const { updateIntegration } = await import('../storage/neon');
  await updateIntegration(integrationId, { status });
}

// Saves verified tool list and MCP config to the integration row after the live MCP test passes.
// Config is persisted to Postgres because Redis writes are unreliable inside WDK steps
// (Upstash Redis uses globalThis.fetch, which WDK intercepts and replays).
async function persistValidation(
  integrationId: string,
  result: SandboxResult,
  config: MCPServerConfig,
) {
  'use step';
  const { BUILD_VERSION } = await import('../config');
  console.log(`[v${BUILD_VERSION}] pipeline.persistValidation: integrationId=${integrationId} sandboxUrl=${result.sandboxUrl} sandboxId=${result.sandboxId} verifiedTools=${result.verifiedTools.length} configTools=${config.tools.length}`);
  const { updateIntegration } = await import('../storage/neon');
  await updateIntegration(integrationId, {
    verified_tools: result.verifiedTools,
    validated_at: new Date().toISOString(),
    config_json: config,
  });
}

// Marks the integration as FAILED in Postgres; called from the catch block and all early-exit paths.
async function failIntegration(integrationId: string) {
  'use step';
  const { updateIntegration, INTEGRATION_STATUS } =
    await import('../storage/neon');
  await updateIntegration(integrationId, { status: INTEGRATION_STATUS.FAILED });
  revalidateTag('integrations', 'hours');
}

// Idempotently creates or retrieves the shared generated-mcps GitHub repo that all MCP servers are deployed from.
async function runEnsureMonorepo(): Promise<MonorepoInfo> {
  'use step';
  const { ensureMonorepo } = await import('./deploy');
  return ensureMonorepo();
}

// Creates a branch with the generated MCP files, opens a PR, and registers a webhook so the workflow resumes on merge.
async function runCreateGitHubPR(
  integrationName: string,
  integrationId: string,
  files: Array<{ file: string; data: string }>,
  monorepo: MonorepoInfo,
  webhookUrl: string,
): Promise<GitHubPRResult> {
  'use step';
  const { createGitHubPR } = await import('./deploy');
  return createGitHubPR(
    integrationName,
    integrationId,
    files,
    monorepo,
    webhookUrl,
  );
}

// Single GitHub API call to read the current PR state; used in the local-dev polling loop instead of webhooks.
async function checkPRStatus(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ state: string; merged: boolean }> {
  'use step';
  const { getOctokit } = await import('./deploy');
  const octokit = getOctokit();
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  return { state: pr.state as string, merged: !!pr.merged };
}

// Removes the GitHub webhook registered for this PR after it fires or the pipeline is cancelled.
async function runDeleteGitHubWebhook(
  owner: string,
  repo: string,
  webhookId: number,
): Promise<void> {
  'use step';
  const { deleteGitHubWebhook } = await import('./deploy');
  await deleteGitHubWebhook(owner, repo, webhookId);
}

// Saves the PR URL and repo name to the integration row so the UI can link to it immediately after PR creation.
async function persistPRInfo(
  integrationId: string,
  prResult: GitHubPRResult,
): Promise<void> {
  'use step';
  const { updateIntegration } = await import('../storage/neon');
  await updateIntegration(integrationId, {
    github_repo_url: prResult.repoUrl,
    github_pr_url: prResult.prUrl,
    github_repo_name: prResult.repoName,
  });
}

// Creates a Vercel project for this MCP server, links it to the monorepo subdirectory, and injects all required env vars.
async function runCreateVercelProject(
  monorepo: MonorepoInfo,
  integrationId: string,
  integrationName: string,
): Promise<VercelProjectResult> {
  'use step';
  const { createVercelProject } = await import('./deploy');
  return createVercelProject(monorepo, integrationId, integrationName);
}

// Fetches the most recent Vercel deployment for the project; returns null if none has been queued yet.
async function runFindDeployment(
  vercelProjectId: string,
): Promise<DeploymentInfo | null> {
  'use step';
  const { findDeployment } = await import('./deploy');
  return findDeployment(vercelProjectId);
}

// Pings the project's production URL to check if the deployment is live.
async function runPingDeployment(
  projectName: string,
): Promise<boolean> {
  'use step';
  const { pingDeployment } = await import('./deploy');
  return pingDeployment(projectName);
}

// Saves the live MCP URL and deployment ID to the integration row and marks status as LIVE.
async function persistDeployment(
  integrationId: string,
  prResult: GitHubPRResult,
  vercelResult: VercelDeployResult,
) {
  'use step';
  const { updateIntegration, INTEGRATION_STATUS } =
    await import('../storage/neon');
  await updateIntegration(integrationId, {
    status: INTEGRATION_STATUS.LIVE,
    mcp_url: vercelResult.mcpUrl,
    deployment_id: vercelResult.deploymentId,
    github_repo_url: prResult.repoUrl,
    github_pr_url: prResult.prUrl,
    github_repo_name: prResult.repoName,
  });
  revalidateTag('integrations', 'hours');
}

// Runs deterministic + AI-assisted security checks on the generated config; blocks deploy if any check returns 'fail'.
async function runSecurityAudit(
  config: MCPServerConfig,
  discovered: DiscoveryResult,
  sourceCode: string,
): Promise<AuditResult> {
  'use step';
  const { performSecurityAudit } = await import('./security-audit');
  return performSecurityAudit(config, discovered, sourceCode);
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
  'use workflow';

  // Track which stage is active so the catch block emits the correct failed event
  let currentStage:
    | 'discover-api'
    | 'build-mcp'
    | 'preview-mcp'
    | 'audit-mcp'
    | 'deploy-mcp' = 'discover-api';

  try {
    // Stage 1: Discovery + Enrichment
    // Fast path: skip AI enrichment call if we've already processed this spec before
    await emitEvent(createEvent('discover-api', 'running'));
    const cachedDiscovery = await checkDiscoveryCache(specHash);
    const discovered = cachedDiscovery ?? (await runDiscovery(spec, specUrl));
    if (!cachedDiscovery) await cacheDiscovery(specHash, discovered);
    await emitEvent(createEvent('discover-api', 'complete', discovered));

    await setIntegrationStatus(integrationId, 'synthesising');

    // Stage 2: Synthesis
    currentStage = 'build-mcp';
    await emitEvent(createEvent('build-mcp', 'running'));
    let config = await runSynthesis(discovered);

    for (const tool of config.tools) {
      await emitEvent(createEvent('build-mcp', 'tool_complete', tool));
    }

    await emitEvent(createEvent('build-mcp', 'complete', config));

    // Cache full unfiltered config before build hook — exclusions are in-memory only, never persisted
    await cacheMcpConfig(specHash, config);

    // ─── Pause: Wait for user to review tools and trigger build ───────────────
    using buildHook = createHook<{ excludedTools: string[] }>({
      token: `build-trigger:${integrationId}`,
    });

    await emitEvent(createEvent('build-mcp', 'awaiting-trigger'));
    const buildPayload = await buildHook;

    // Filter out tools the user toggled off
    if (buildPayload.excludedTools.length > 0) {
      const excluded = new Set(buildPayload.excludedTools);
      config = {
        ...config,
        tools: config.tools.filter((t) => !excluded.has(t.name)),
      };
    }

    // Silent structural pre-flight — not a visible stage
    const { validateConfig } = await import('./validate');
    const structural = validateConfig(config, discovered);

    if (!structural.valid) {
      const errorMsg = structural.errors
        .map((e) => `${e.tool}: ${e.message}`)
        .join('; ');
      await emitEvent(
        createEvent('preview-mcp', 'failed', {
          errors: errorMsg,
        } satisfies ValidateEventData),
      );
      await failIntegration(integrationId);
      await emitEvent(createEvent('preview-mcp', 'done'));
      return config;
    }

    // Codegen
    currentStage = 'preview-mcp';
    let bundle = await runCodegen(config);

    // Stage 3: Validate — build + start + live MCP test
    await emitEvent(
      createEvent('preview-mcp', 'running', {
        sourceCode: bundle.sourceCode,
      } satisfies ValidateEventData),
    );
    await setIntegrationStatus(integrationId, 'validating');

    let sandboxResult = await runValidateSandbox(bundle, config);

    for (const log of sandboxResult.buildLogs) {
      await emitEvent(
        createEvent('preview-mcp', 'building', {
          buildLog: log,
        } satisfies ValidateEventData),
      );
    }

    // Sandbox build failed — retry synthesis once with build errors as context
    if (!sandboxResult.ok && sandboxResult.errors) {
      await emitEvent(
        createEvent('preview-mcp', 'retrying', {
          errors: sandboxResult.errors,
        } satisfies ValidateEventData),
      );
      currentStage = 'build-mcp';
      await emitEvent(createEvent('build-mcp', 'running'));
      config = await runSynthesisWithBuildErrors(
        discovered,
        sandboxResult.errors,
      );

      for (const tool of config.tools) {
        await emitEvent(createEvent('build-mcp', 'tool_complete', tool));
      }

      await emitEvent(createEvent('build-mcp', 'complete', config));

      currentStage = 'preview-mcp';
      bundle = await runCodegen(config);
      await emitEvent(
        createEvent('preview-mcp', 'running', {
          sourceCode: bundle.sourceCode,
        } satisfies ValidateEventData),
      );

      sandboxResult = await runValidateSandbox(bundle, config);

      for (const log of sandboxResult.buildLogs) {
        await emitEvent(
          createEvent('preview-mcp', 'building', {
            buildLog: log,
          } satisfies ValidateEventData),
        );
      }
    }

    if (!sandboxResult.ok) {
      await emitEvent(
        createEvent('preview-mcp', 'failed', {
          error: sandboxResult.errors ?? 'Sandbox build failed',
        }),
      );
      await failIntegration(integrationId);
      await emitEvent(createEvent('preview-mcp', 'done'));
      return config;
    }

    await emitEvent(
      createEvent('preview-mcp', 'complete', {
        verifiedTools: sandboxResult.verifiedTools,
        toolCount: sandboxResult.verifiedTools.length,
        sandboxUrl: sandboxResult.sandboxUrl,
        sandboxId: sandboxResult.sandboxId,
      } satisfies ValidateEventData),
    );

    // Persist validation proof + MCP config to Neon (primary store; Redis is unreliable in WDK)
    await persistValidation(integrationId, sandboxResult, config);

    // Cache results only after validation passes
    await commitSpecUrlIndex(specHash, specUrl);

    await emitEvent(createEvent('preview-mcp', 'done'));

    // ─── Pause: Wait for manual trigger (iterable — allows re-runs) ─────────
    // Create hook BEFORE emitting the UI event to prevent resumeHook racing ahead.
    using auditHook = createHook<{ triggered: boolean }>({
      token: `audit-trigger:${integrationId}`,
    });

    await emitEvent(createEvent('audit-mcp', 'awaiting-trigger'));

    for await (const _trigger of auditHook) {
      // Apply user edits (if any) before each audit run
      const editedSource = await loadSourceOverride(integrationId);

      if (editedSource) {
        bundle = {
          ...bundle,
          sourceCode: editedSource,
          files: bundle.files.map((f) =>
            f.file === 'app/[transport]/route.ts'
              ? { ...f, data: editedSource }
              : f,
          ),
        };
        // Clear override after consuming — prevents stale edits on future re-audit triggers
        await clearSourceOverride(integrationId);
      }

      // ─── Stage 3.5: Security Audit ─────────────────────────────────────────
      currentStage = 'audit-mcp';
      await emitEvent(createEvent('audit-mcp', 'running'));

      const auditResult = await runSecurityAudit(
        config,
        discovered,
        bundle.sourceCode,
      );

      for (const auditFinding of auditResult.findings) {
        await emitEvent(
          createEvent('audit-mcp', 'finding', {
            finding: auditFinding,
          } satisfies AuditEventData),
        );
      }

      const auditStatus = auditResult.passed ? 'complete' : 'failed';
      await emitEvent(
        createEvent('audit-mcp', auditStatus, {
          summary: auditResult.summary,
          blocked: !auditResult.passed,
        } satisfies AuditEventData),
      );

      if (auditResult.passed) break;

      // Audit failed — wait for user to re-trigger
      await emitEvent(createEvent('audit-mcp', 'awaiting-trigger'));
    }

    // ─── Stage 4: Deploy MCP ─────────────────────────────────────────────────
    currentStage = 'deploy-mcp';
    await emitEvent(
      createEvent('deploy-mcp', 'running', {
        step: 'create-repo',
      } satisfies DeployEventData),
    );
    await setIntegrationStatus(integrationId, 'deploying');

    const monorepo = await runEnsureMonorepo();

    await emitEvent(
      createEvent('deploy-mcp', 'running', {
        step: 'push-files',
        repoName: monorepo.repoName,
      } satisfies DeployEventData),
    );

    // Create a Workflow webhook — GitHub will POST to this URL when the PR is merged,
    // suspending the workflow durably instead of polling.
    using prWebhook = createWebhook({
      respondWith: Response.json({ ok: true }),
    });

    const prResult = await runCreateGitHubPR(
      discovered.apiName,
      integrationId,
      bundle.files,
      monorepo,
      prWebhook.url,
    );

    // Persist PR info immediately so the UI can show the link even if the user refreshes
    await persistPRInfo(integrationId, prResult);

    // Create the Vercel project BEFORE the merge wait so that Vercel's GitHub
    // integration is already listening when the merge push event arrives.
    const projectResult = await runCreateVercelProject(
      monorepo,
      integrationId,
      discovered.apiName,
    );

    for (const line of projectResult.setupLogs) {
      await emitEvent(
        createEvent('deploy-mcp', 'building', {
          buildLog: line,
        } satisfies DeployEventData),
      );
    }

    await emitEvent(
      createEvent('deploy-mcp', 'running', {
        step: 'pr-open',
        prUrl: prResult.prUrl,
        prTitle: prResult.prTitle,
        repoUrl: prResult.repoUrl,
        repoName: prResult.repoName,
        prStatus: 'open',
      } satisfies DeployEventData),
    );

    await emitEvent(
      createEvent('deploy-mcp', 'running', {
        step: 'await-merge',
        prUrl: prResult.prUrl,
        prStatus: 'open',
        waitMessage: 'Waiting for PR to be merged...',
      } satisfies DeployEventData),
    );

    // Wait for the PR to be merged.
    // In prod: suspend durably via GitHub webhook (event-driven).
    // In dev: GitHub rejects localhost webhook URLs, so poll the API every 30s instead.
    const isLocalDev = appConfig.deploy.localUrlPrefixes.some((p) =>
      prWebhook.url.startsWith(p),
    );

    let mergeResult = { merged: false, closedWithoutMerge: false };

    if (isLocalDev) {
      const POLL_DEADLINE_MS = 24 * 60 * 60 * 1000;
      const pollStart = Date.now();

      while (Date.now() - pollStart < POLL_DEADLINE_MS) {
        const prStatus = await checkPRStatus(
          prResult.repoOwner,
          prResult.repoName,
          prResult.prNumber,
        );

        if (prStatus.state === 'closed') {
          mergeResult = {
            merged: prStatus.merged,
            closedWithoutMerge: !prStatus.merged,
          };
          break;
        }

        await sleep('30s');
      }
    } else {
      type GHPREvent = {
        action?: string;
        pull_request?: { number: number; merged: boolean };
      };

      for await (const ghRequest of prWebhook) {
        const body = (await ghRequest.json()) as GHPREvent;
        if (body.pull_request?.number !== prResult.prNumber) continue;

        if (body.action === 'closed' && body.pull_request?.merged === true) {
          mergeResult = { merged: true, closedWithoutMerge: false };
          break;
        }

        if (body.action === 'closed') {
          mergeResult = { merged: false, closedWithoutMerge: true };
          break;
        }
      }

      await runDeleteGitHubWebhook(
        prResult.repoOwner,
        prResult.repoName,
        prResult.githubWebhookId,
      );
    }

    if (!mergeResult.merged) {
      const reason = mergeResult.closedWithoutMerge
        ? 'PR was closed without merging.'
        : 'Timed out waiting for PR merge (24h limit).';
      await emitEvent(
        createEvent('deploy-mcp', 'failed', {
          error: reason,
        } satisfies DeployEventData),
      );
      await failIntegration(integrationId);
      await emitEvent(createEvent('deploy-mcp', 'done'));
      return config;
    }

    await emitEvent(
      createEvent('deploy-mcp', 'running', {
        step: 'merged',
        prUrl: prResult.prUrl,
        prStatus: 'merged',
      } satisfies DeployEventData),
    );

    await emitEvent(
      createEvent('deploy-mcp', 'running', {
        step: 'deploying',
      } satisfies DeployEventData),
    );

    // Ping the project's production URL until it responds — replaces the
    // two-phase getDeployments/checkDeploymentStatus polling that could miss
    // deployments due to API timing issues.
    const mcpUrl = `https://${projectResult.projectName}.vercel.app`;
    await emitEvent(
      createEvent('deploy-mcp', 'building', {
        buildLog: 'Waiting for deployment to go live...',
      } satisfies DeployEventData),
    );

    const PING_TIMEOUT_MS = 10 * 60 * 1000;
    const PING_POLL_MS = 15_000;
    const pingDeadline = Date.now() + PING_TIMEOUT_MS;
    let live = false;

    while (!live) {
      if (Date.now() > pingDeadline) {
        throw new Error(
          'Deployment did not go live within 10 minutes — check the Vercel dashboard.',
        );
      }

      await sleep(PING_POLL_MS);
      live = await runPingDeployment(projectResult.projectName);

      if (!live) {
        await emitEvent(
          createEvent('deploy-mcp', 'building', {
            buildLog: 'Still waiting for deployment...',
          } satisfies DeployEventData),
        );
      }
    }

    await emitEvent(
      createEvent('deploy-mcp', 'building', {
        buildLog: '✓ Deployment READY',
      } satisfies DeployEventData),
    );

    // Best-effort: grab the deployment UID for record-keeping
    const deployment = await runFindDeployment(projectResult.vercelProjectId);

    const vercelResult: VercelDeployResult = {
      vercelProjectId: projectResult.vercelProjectId,
      deploymentId: deployment?.uid ?? '',
      mcpUrl,
      buildLogs: [],
    };

    await persistDeployment(integrationId, prResult, vercelResult);

    await emitEvent(
      createEvent('deploy-mcp', 'complete', {
        step: 'live',
        mcpUrl: vercelResult.mcpUrl,
        deploymentId: vercelResult.deploymentId,
        prUrl: prResult.prUrl,
        repoUrl: prResult.repoUrl,
      } satisfies DeployEventData),
    );

    await emitEvent(createEvent('deploy-mcp', 'done'));

    return config;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('Pipeline error:', errorMsg);
    await emitEvent(
      createEvent(currentStage, 'failed', {
        error: `Deploy failed: ${errorMsg}`,
      }),
    );
    await failIntegration(integrationId);
    await emitEvent(createEvent(currentStage, 'done'));
    throw err;
  }
}
