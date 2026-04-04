// Stage orchestrators — plain async functions that group step calls into logical stages.
// No WDK directive — they inherit the 'use workflow' context of the caller.
// The WDK replay log sees the same step calls in the same order.

import { createEvent, type ValidateEventData, type DeployEventData, type AuditEventData } from './events';
import type { DiscoveryResult } from './discover';
import type { MCPServerConfig } from '../mcp/types';
import type { BundleResult } from '../mcp/bundle';
import type { SandboxResult } from './sandbox';
import type { GitHubPRResult, MonorepoInfo, VercelProjectResult, VercelDeployResult } from './deploy';
import {
  emitEvent,
  checkDiscoveryCache,
  runDiscovery,
  runSynthesis,
  runSynthesisWithBuildErrors,
  loadSourceOverride,
  clearSourceOverride,
  runCodegen,
  runValidateSandbox,
  cacheDiscovery,
  cacheMcpConfig,
  commitSpecUrlIndex,
  setIntegrationStatus,
  persistValidation,
  failIntegration,
  runEnsureMonorepo,
  runCreateGitHubPR,
  persistPRInfo,
  runCreateVercelProject,
  runFindDeployment,
  persistDeployment,
  runSecurityAudit,
} from './steps';

export async function runDiscoveryStage(
  spec: Record<string, unknown>,
  specHash: string,
  specUrl: string,
): Promise<DiscoveryResult> {
  await emitEvent(createEvent('discover-api', 'running'));
  const cachedDiscovery = await checkDiscoveryCache(specHash);
  const discovered = cachedDiscovery ?? (await runDiscovery(spec, specUrl));
  if (!cachedDiscovery) await cacheDiscovery(specHash, discovered);
  await emitEvent(createEvent('discover-api', 'complete', discovered));
  return discovered;
}

export async function runSynthesisStage(
  integrationId: string,
  discovered: DiscoveryResult,
  specHash: string,
): Promise<MCPServerConfig> {
  await setIntegrationStatus(integrationId, 'synthesising');
  await emitEvent(createEvent('build-mcp', 'running'));
  const config = await runSynthesis(discovered);

  for (const tool of config.tools) {
    await emitEvent(createEvent('build-mcp', 'tool_complete', tool));
  }

  await emitEvent(createEvent('build-mcp', 'complete', config));
  await cacheMcpConfig(specHash, config);
  return config;
}

export async function applyBuildPayload(
  config: MCPServerConfig,
  discovered: DiscoveryResult,
  integrationId: string,
  excludedTools: string[],
): Promise<{ ok: true; config: MCPServerConfig } | { ok: false }> {
  if (excludedTools.length > 0) {
    const excluded = new Set(excludedTools);
    config = {
      ...config,
      tools: config.tools.filter((t) => !excluded.has(t.name)),
    };
  }

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
    return { ok: false };
  }

  return { ok: true, config };
}

export async function runCodegenAndSandbox(
  config: MCPServerConfig,
  integrationId: string,
): Promise<{ bundle: BundleResult; sandboxResult: SandboxResult }> {
  const bundle = await runCodegen(config);

  await emitEvent(
    createEvent('preview-mcp', 'running', {
      sourceCode: bundle.sourceCode,
    } satisfies ValidateEventData),
  );
  await setIntegrationStatus(integrationId, 'validating');

  const sandboxResult = await runValidateSandbox(bundle, config);

  for (const log of sandboxResult.buildLogs) {
    await emitEvent(
      createEvent('preview-mcp', 'building', {
        buildLog: log,
      } satisfies ValidateEventData),
    );
  }

  return { bundle, sandboxResult };
}

export async function runSynthesisRetry(
  discovered: DiscoveryResult,
  errors: string,
): Promise<MCPServerConfig> {
  await emitEvent(createEvent('build-mcp', 'running'));
  const config = await runSynthesisWithBuildErrors(discovered, errors);

  for (const tool of config.tools) {
    await emitEvent(createEvent('build-mcp', 'tool_complete', tool));
  }

  await emitEvent(createEvent('build-mcp', 'complete', config));
  return config;
}

export async function handleSandboxFailure(
  integrationId: string,
  sandboxResult: SandboxResult,
): Promise<void> {
  await emitEvent(
    createEvent('preview-mcp', 'failed', {
      error: sandboxResult.errors ?? 'Sandbox build failed',
    }),
  );
  await failIntegration(integrationId);
  await emitEvent(createEvent('preview-mcp', 'done'));
}

export async function persistValidationStage(
  integrationId: string,
  sandboxResult: SandboxResult,
  config: MCPServerConfig,
  specHash: string,
  specUrl: string,
): Promise<void> {
  await emitEvent(
    createEvent('preview-mcp', 'complete', {
      verifiedTools: sandboxResult.verifiedTools,
      toolCount: sandboxResult.verifiedTools.length,
      sandboxUrl: sandboxResult.sandboxUrl,
      sandboxId: sandboxResult.sandboxId,
    } satisfies ValidateEventData),
  );

  await persistValidation(integrationId, sandboxResult, config);
  await commitSpecUrlIndex(specHash, specUrl);
  await emitEvent(createEvent('preview-mcp', 'done'));
}

export async function runAuditIteration(
  integrationId: string,
  config: MCPServerConfig,
  discovered: DiscoveryResult,
  bundle: BundleResult,
): Promise<{ passed: boolean; bundle: BundleResult }> {
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
    await clearSourceOverride(integrationId);
  }

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

  return { passed: auditResult.passed, bundle };
}

export async function runPreMergeDeploy(
  integrationId: string,
  discovered: DiscoveryResult,
  bundle: BundleResult,
  webhookUrl: string,
): Promise<{ monorepo: MonorepoInfo; prResult: GitHubPRResult; projectResult: VercelProjectResult }> {
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

  const prResult = await runCreateGitHubPR(
    discovered.apiName,
    integrationId,
    bundle.files,
    monorepo,
    webhookUrl,
  );

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

  return { monorepo, prResult, projectResult };
}

export async function handleMergeFailure(
  integrationId: string,
  mergeResult: { merged: boolean; closedWithoutMerge: boolean },
): Promise<void> {
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
}

export async function emitPostMergeStatus(
  prResult: GitHubPRResult,
  projectResult: VercelProjectResult,
): Promise<string> {
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

  const mcpUrl = `https://${projectResult.projectName}.vercel.app`;
  await emitEvent(
    createEvent('deploy-mcp', 'building', {
      buildLog: 'Waiting for deployment to go live...',
    } satisfies DeployEventData),
  );

  return mcpUrl;
}

export async function finalizeDeployment(
  integrationId: string,
  prResult: GitHubPRResult,
  projectResult: VercelProjectResult,
  mcpUrl: string,
): Promise<void> {
  await emitEvent(
    createEvent('deploy-mcp', 'building', {
      buildLog: '✓ Deployment READY',
    } satisfies DeployEventData),
  );

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
}
