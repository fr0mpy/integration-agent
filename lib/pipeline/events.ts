import type { DiscoveryResult } from './discover'
import type { MCPServerConfig, MCPToolDefinition } from '../mcp/types'

export type PipelineStage = 'discover' | 'synthesise' | 'validate' | 'sandbox' | 'deploy'

export type PipelineStatus =
  | 'running'
  | 'complete'
  | 'failed'
  | 'tool_complete'
  | 'tool_validated'

export interface PipelineEvent {
  stage: PipelineStage
  status: PipelineStatus
  data: DiscoveryResult | MCPServerConfig | MCPToolDefinition | { error: string } | null
  timestamp: number
}

export function createEvent(
  stage: PipelineStage,
  status: PipelineStatus,
  data: PipelineEvent['data'] = null,
): PipelineEvent {
  return { stage, status, data, timestamp: Date.now() }
}
