import type { DiscoveryResult } from './discover'
import type { MCPServerConfig, MCPToolDefinition } from '../mcp/types'

export type PipelineStage = 'discover-api' | 'build-mcp' | 'preview-mcp' | 'deploy-mcp' | 'health-check'

export type PipelineStatus =
  | 'running'
  | 'complete'
  | 'failed'
  | 'tool_complete'
  | 'building'
  | 'done'

export interface ValidateEventData {
  sourceCode?: string
  buildLog?: string
  sandboxUrl?: string
  sandboxId?: string | null
  verifiedTools?: string[]
  toolCount?: number
  errors?: string
}

export interface PipelineEvent {
  stage: PipelineStage
  status: PipelineStatus
  data:
    | DiscoveryResult
    | MCPServerConfig
    | MCPToolDefinition
    | ValidateEventData
    | { error: string }
    | null
  timestamp: number
}

export function createEvent(
  stage: PipelineStage,
  status: PipelineStatus,
  data: PipelineEvent['data'] = null,
): PipelineEvent {
  return { stage, status, data, timestamp: Date.now() }
}
