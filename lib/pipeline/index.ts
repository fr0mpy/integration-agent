// Pipeline orchestrator — the 'use workflow' entry point.
// Steps live in ./steps.ts, stage orchestrators in ./stages.ts.

import {
  createWebhook,
  createHook,
  sleep,
  fetch as wfFetch,
} from 'workflow';
import { neonConfig } from '@neondatabase/serverless';
import { createEvent, type ValidateEventData, type DeployEventData } from './events';
import { config as appConfig } from '../config';

import { emitEvent, checkPRStatus, runDeleteGitHubWebhook, runPingDeployment } from './steps';
import {
  runDiscoveryStage,
  runSynthesisStage,
  applyBuildPayload,
  runCodegenAndSandbox,
  runSynthesisRetry,
  handleSandboxFailure,
  persistValidationStage,
  runAuditIteration,
  runPreMergeDeploy,
  handleMergeFailure,
  emitPostMergeStatus,
  finalizeDeployment,
} from './stages';
import { failIntegration } from './steps';

// WDK intercepts globalThis.fetch inside 'use step' / 'use workflow' functions and throws
// if code tries to use it directly. Fix: configure Neon to use WDK's fetch, the officially
// supported approach (https://useworkflow.dev/err/fetch-in-workflow).
neonConfig.fetchFunction = wfFetch;

// deploy.ts only reaches the module cache via dynamic imports inside step functions —
// by the time those run, WDK has replaced globalThis.fetch with an error-throwing sentinel.
// Force a static load here so deploy.ts's `const _fetch = globalThis.fetch` captures the
// real fetch before any step executes.
import './deploy';

/**
 * Durable synthesis pipeline.
 * Stages: Discover → Synthesise → Validate (live MCP test) → Audit → Deploy
 *
 * Hook creation, webhook iteration, and sleep loops stay inline because
 * they are workflow-level primitives (not available in 'use step').
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
    const discovered = await runDiscoveryStage(spec, specHash, specUrl);

    // Stage 2: Synthesis
    currentStage = 'build-mcp';
    let config = await runSynthesisStage(integrationId, discovered, specHash);

    // ─── Pause: user reviews tools and triggers build ────────────────────────
    using buildHook = createHook<{ excludedTools: string[] }>({
      token: `build-trigger:${integrationId}`,
    });

    await emitEvent(createEvent('build-mcp', 'awaiting-trigger'));
    const buildPayload = await buildHook;

    const buildResult = await applyBuildPayload(
      config, discovered, integrationId, buildPayload.excludedTools,
    );
    if (!buildResult.ok) return config;
    config = buildResult.config;

    // Stage 3: Codegen + Sandbox Validation
    currentStage = 'preview-mcp';
    let { bundle, sandboxResult } = await runCodegenAndSandbox(config, integrationId);

    // Retry synthesis once if sandbox build failed
    if (!sandboxResult.ok && sandboxResult.errors) {
      await emitEvent(
        createEvent('preview-mcp', 'retrying', {
          errors: sandboxResult.errors,
        } satisfies ValidateEventData),
      );
      currentStage = 'build-mcp';
      config = await runSynthesisRetry(discovered, sandboxResult.errors);
      currentStage = 'preview-mcp';
      ({ bundle, sandboxResult } = await runCodegenAndSandbox(config, integrationId));
    }

    if (!sandboxResult.ok) {
      await handleSandboxFailure(integrationId, sandboxResult);
      return config;
    }

    await persistValidationStage(integrationId, sandboxResult, config, specHash, specUrl);

    // ─── Pause: audit hook (iterable — allows re-runs) ──────────────────────
    using auditHook = createHook<{ triggered: boolean; override?: boolean }>({
      token: `audit-trigger:${integrationId}`,
    });

    await emitEvent(createEvent('audit-mcp', 'awaiting-trigger'));

    for await (const trigger of auditHook) {
      if (trigger.override) break;
      currentStage = 'audit-mcp';
      const auditIterResult = await runAuditIteration(
        integrationId, config, discovered, bundle,
      );
      bundle = auditIterResult.bundle;
      if (auditIterResult.passed) break;
      await emitEvent(createEvent('audit-mcp', 'awaiting-trigger'));
    }

    // ─── Stage 4: Deploy MCP ─────────────────────────────────────────────────
    currentStage = 'deploy-mcp';

    using prWebhook = createWebhook({
      respondWith: Response.json({ ok: true }),
    });

    const { prResult, projectResult } = await runPreMergeDeploy(
      integrationId, discovered, bundle, prWebhook.url,
    );

    // ─── Wait for PR merge (inline — webhook/sleep cannot leave workflow) ────
    const isLocalDev = appConfig.deploy.localUrlPrefixes.some((p) =>
      prWebhook.url.startsWith(p),
    );

    let mergeResult = { merged: false, closedWithoutMerge: false };

    if (isLocalDev) {
      const POLL_DEADLINE_MS = appConfig.deploy.pollDeadlineMs;
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
      await handleMergeFailure(integrationId, mergeResult);
      return config;
    }

    // ─── Post-merge: ping deployment until live (inline — uses sleep) ────────
    const mcpUrl = await emitPostMergeStatus(prResult, projectResult);

    const PING_TIMEOUT_MS = appConfig.deploy.pingTimeoutMs;
    const PING_POLL_MS = appConfig.deploy.pingPollMs;
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

    await finalizeDeployment(integrationId, prResult, projectResult, mcpUrl);

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
