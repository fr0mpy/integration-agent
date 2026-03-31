import { getWritable } from 'workflow'
import { createEvent, type PipelineEvent, type ValidateEventData } from './events'
import type { DiscoveryResult } from './discover'
import type { MCPServerConfig } from '../mcp/types'

async function emitEvent(event: PipelineEvent) {
  'use step'
  const writable = getWritable<PipelineEvent>()
  const writer = writable.getWriter()
  await writer.write(event)
  writer.releaseLock()
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

async function runCodegen(config: MCPServerConfig): Promise<{ files: Array<{ file: string; data: string }>; sourceCode: string }> {
  'use step'
  const { bundleServer } = await import('../mcp/bundle')
  return bundleServer(config)
}

async function runValidateSandbox(
  bundle: { files: Array<{ file: string; data: string }>; sourceCode: string },
  config: MCPServerConfig,
  onLog: (log: string) => void,
) {
  'use step'
  const { runSandboxCheck } = await import('./sandbox-check')
  return runSandboxCheck(bundle, config, onLog)
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

async function failIntegration(integrationId: string) {
  'use step'
  const { updateIntegration, INTEGRATION_STATUS } = await import('../storage/neon')
  await updateIntegration(integrationId, { status: INTEGRATION_STATUS.FAILED })
}

/**
 * Durable synthesis pipeline.
 * Stages: Discover → Synthesise → Validate (live MCP test) → Deploy
 */
export async function synthesisePipeline(
  integrationId: string,
  spec: Record<string, unknown>,
  specHash: string,
  specUrl: string,
) {
  'use workflow'

  try {
    // Stage 1: Discovery + Enrichment
    await emitEvent(createEvent('discover-api', 'running'))
    const discovered = await runDiscovery(spec)
    await emitEvent(createEvent('discover-api', 'complete', discovered))

    await setIntegrationStatus(integrationId, 'synthesising')

    // Stage 2: Synthesis
    await emitEvent(createEvent('build-mcp', 'running'))
    const config = await runSynthesis(discovered)

    for (const tool of config.tools) {
      await emitEvent(createEvent('build-mcp', 'tool_complete', tool))
    }
    await emitEvent(createEvent('build-mcp', 'complete', config))

    // Silent structural pre-flight — not a visible stage
    const { validateConfig } = await import('./validate')
    const structural = validateConfig(config, discovered)
    if (!structural.valid) {
      const errorMsg = structural.errors.map((e) => `${e.tool}: ${e.message}`).join('; ')
      await emitEvent(createEvent('preview-mcp', 'failed', { errors: errorMsg } satisfies ValidateEventData))
      await failIntegration(integrationId)
      return config
    }

    // Codegen
    const bundle = await runCodegen(config)

    // Stage 3: Validate — build + start + live MCP test
    await emitEvent(createEvent('preview-mcp', 'running', { sourceCode: bundle.sourceCode } satisfies ValidateEventData))
    await setIntegrationStatus(integrationId, 'validating')

    const sandboxResult = await runValidateSandbox(bundle, config, async (log) => {
      await emitEvent(createEvent('preview-mcp', 'building', { buildLog: log } satisfies ValidateEventData))
    })

    if (!sandboxResult.ok) {
      await emitEvent(createEvent('preview-mcp', 'failed', { errors: sandboxResult.errors } satisfies ValidateEventData))
      await failIntegration(integrationId)
      return config
    }

    await emitEvent(createEvent('preview-mcp', 'complete', {
      verifiedTools: sandboxResult.verifiedTools,
      toolCount: sandboxResult.verifiedTools.length,
      sandboxUrl: sandboxResult.sandboxUrl,
    } satisfies ValidateEventData))

    // Cache results only after validation passes
    await cacheResults(specHash, specUrl, config, discovered)

    return config
  } catch (err) {
    console.error('Pipeline error:', err instanceof Error ? err.message : 'unknown')
    await emitEvent(createEvent('build-mcp', 'failed', { error: 'Pipeline failed. Please try again.' }))
    await failIntegration(integrationId)
    throw err
  }
}
