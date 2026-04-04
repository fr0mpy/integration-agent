// WDK step wrappers — thin functions that dynamic-import modules inside 'use step' blocks.
// Each step is an isolated, retryable unit of durable work.

import { getWritable } from 'workflow';
import { revalidateTag } from 'next/cache';
import {
  createEvent,
  type PipelineEvent,
} from './events';
import type { DiscoveryResult } from './discover';
import type { MCPServerConfig } from '../mcp/types';
import type { SandboxResult } from './sandbox';
import type { AuditResult } from './audit';
import type {
  GitHubPRResult,
  MonorepoInfo,
  VercelDeployResult,
  VercelProjectResult,
  DeploymentInfo,
} from './deploy';

// Writes a single typed event to the WDK SSE stream; every stage progress update the UI sees goes through here.
export async function emitEvent(event: PipelineEvent) {
  'use step';
  const writable = getWritable<PipelineEvent>();
  const writer = writable.getWriter();
  await writer.write(event);
  writer.releaseLock();
}

// Returns a cached DiscoveryResult for this spec hash if one exists; skips re-scraping the same URL on retries.
export async function checkDiscoveryCache(
  specHash: string,
): Promise<DiscoveryResult | null> {
  'use step';
  const { discoveryCache } = await import('../storage/redis');
  return (await discoveryCache.get(specHash)) as DiscoveryResult | null;
}

// Parses the OpenAPI spec and optionally enriches the endpoint list via AI; produces the structured input for synthesis.
export async function runDiscovery(
  spec: Record<string, unknown>,
  specUrl: string,
): Promise<DiscoveryResult> {
  'use step';
  const { discoverEndpoints, enrichDiscovery } = await import('./discover');
  const raw = await discoverEndpoints(spec, specUrl);
  return enrichDiscovery(raw);
}

// Calls the synthesis LLM to convert discovered endpoints into MCP tool definitions; first attempt with no prior error context.
export async function runSynthesis(
  discovered: DiscoveryResult,
): Promise<MCPServerConfig> {
  'use step';
  const { synthesiseTools } = await import('./synthesise');
  return synthesiseTools(discovered);
}

// Retries synthesis with sandbox build errors injected into the prompt; called when the first codegen pass produces uncompilable TypeScript.
export async function runSynthesisWithBuildErrors(
  discovered: DiscoveryResult,
  buildErrors: string,
): Promise<MCPServerConfig> {
  'use step';
  const { synthesiseTools } = await import('./synthesise');
  return synthesiseTools(discovered, buildErrors);
}

// Fetches a user-edited source file from Redis if one exists; applied before each re-audit so manual edits are picked up.
export async function loadSourceOverride(
  integrationId: string,
): Promise<string | null> {
  'use step';
  const { sourceOverride } = await import('../storage/redis');
  return sourceOverride.get(integrationId);
}

// Deletes the source override after it has been consumed; prevents stale edits from re-applying on future re-audit triggers.
export async function clearSourceOverride(integrationId: string): Promise<void> {
  'use step';
  const { sourceOverride } = await import('../storage/redis');
  await sourceOverride.del(integrationId);
}

// Bundles the MCP config into deployable Next.js files; produces the file set written to the sandbox and later pushed to GitHub.
export async function runCodegen(config: MCPServerConfig): Promise<{
  files: Array<{ file: string; data: string }>;
  sourceCode: string;
}> {
  'use step';
  const { bundleServer } = await import('../mcp/bundle');
  return bundleServer(config);
}

// Boots a Vercel Sandbox, builds and starts the MCP server, and verifies all tool names via a live MCP client call.
export async function runValidateSandbox(
  bundle: { files: Array<{ file: string; data: string }>; sourceCode: string },
  config: MCPServerConfig,
) {
  'use step';
  const { runSandboxCheck } = await import('./sandbox');
  return runSandboxCheck(bundle, config);
}

// Writes discovery result to Redis immediately after discovery runs; safe to cache before sandbox since it's deterministic.
export async function cacheDiscovery(specHash: string, discovered: DiscoveryResult) {
  'use step';
  const { discoveryCache } = await import('../storage/redis');
  await discoveryCache.set(specHash, discovered);
}

// Writes the full unfiltered MCP config to Redis before the build hook fires.
// Stores all tools so cached config is never locked to a prior exclusion choice.
export async function cacheMcpConfig(specHash: string, config: MCPServerConfig) {
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
export async function commitSpecUrlIndex(specHash: string, specUrl: string) {
  'use step';
  const { specUrlIndex } = await import('../storage/redis');
  await specUrlIndex.setHash(specUrl, specHash);
}

// Updates the integration row's status column in Postgres; drives the status badge in the UI.
export async function setIntegrationStatus(integrationId: string, status: string) {
  'use step';
  const { updateIntegration } = await import('../storage/neon');
  await updateIntegration(integrationId, { status });
}

// Saves verified tool list and MCP config to the integration row after the live MCP test passes.
// Config is persisted to Postgres because Redis writes are unreliable inside WDK steps
// (Upstash Redis uses globalThis.fetch, which WDK intercepts and replays).
export async function persistValidation(
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
export async function failIntegration(integrationId: string) {
  'use step';
  const { updateIntegration, INTEGRATION_STATUS } =
    await import('../storage/neon');
  await updateIntegration(integrationId, { status: INTEGRATION_STATUS.FAILED });
  revalidateTag('integrations', 'hours');
}

// Idempotently creates or retrieves the shared generated-mcps GitHub repo that all MCP servers are deployed from.
export async function runEnsureMonorepo(): Promise<MonorepoInfo> {
  'use step';
  const { ensureMonorepo } = await import('./deploy');
  return ensureMonorepo();
}

// Creates a branch with the generated MCP files, opens a PR, and registers a webhook so the workflow resumes on merge.
export async function runCreateGitHubPR(
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
export async function checkPRStatus(
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
export async function runDeleteGitHubWebhook(
  owner: string,
  repo: string,
  webhookId: number,
): Promise<void> {
  'use step';
  const { deleteGitHubWebhook } = await import('./deploy');
  await deleteGitHubWebhook(owner, repo, webhookId);
}

// Saves the PR URL and repo name to the integration row so the UI can link to it immediately after PR creation.
export async function persistPRInfo(
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
export async function runCreateVercelProject(
  monorepo: MonorepoInfo,
  integrationId: string,
  integrationName: string,
): Promise<VercelProjectResult> {
  'use step';
  const { createVercelProject } = await import('./deploy');
  return createVercelProject(monorepo, integrationId, integrationName);
}

// Fetches the most recent Vercel deployment for the project; returns null if none has been queued yet.
export async function runFindDeployment(
  vercelProjectId: string,
): Promise<DeploymentInfo | null> {
  'use step';
  const { findDeployment } = await import('./deploy');
  return findDeployment(vercelProjectId);
}

// Pings the project's production URL to check if the deployment is live.
export async function runPingDeployment(
  projectName: string,
): Promise<boolean> {
  'use step';
  const { pingDeployment } = await import('./deploy');
  return pingDeployment(projectName);
}

// Saves the live MCP URL and deployment ID to the integration row and marks status as LIVE.
export async function persistDeployment(
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
export async function runSecurityAudit(
  config: MCPServerConfig,
  discovered: DiscoveryResult,
  sourceCode: string,
): Promise<AuditResult> {
  'use step';
  const { performSecurityAudit } = await import('./audit');
  return performSecurityAudit(config, discovered, sourceCode);
}
