import { getWritable } from 'workflow'
import { createEvent, type PipelineEvent } from './events'
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

async function cacheResults(specHash: string, specUrl: string, config: MCPServerConfig) {
  'use step'
  const { configCache, urlCache } = await import('../storage/redis')
  await configCache.set(specHash, config)
  await urlCache.setHash(specUrl, specHash)
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
 * Runs discovery → enrichment → synthesis as workflow steps.
 * Streams PipelineEvents via getWritable() for real-time UI updates.
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
    await emitEvent(createEvent('discover', 'running'))
    const discovered = await runDiscovery(spec)
    await emitEvent(createEvent('discover', 'complete', discovered))

    // Update status in Neon
    await setIntegrationStatus(integrationId, 'synthesising')

    // Stage 2: Synthesis
    await emitEvent(createEvent('synthesise', 'running'))
    const config = await runSynthesis(discovered)

    // Emit each tool individually for progressive UI updates
    for (const tool of config.tools) {
      await emitEvent(createEvent('synthesise', 'tool_complete', tool))
    }
    await emitEvent(createEvent('synthesise', 'complete', config))

    // Cache results only after successful synthesis
    await cacheResults(specHash, specUrl, config)

    return config
  } catch (err) {
    console.error('Pipeline error:', err instanceof Error ? err.message : 'unknown')
    await emitEvent(createEvent('synthesise', 'failed', { error: 'Pipeline failed. Please try again.' }))
    await failIntegration(integrationId)
    throw err
  }
}
