import type { DiscoveryResult } from './discover'
import type { MCPServerConfig, MCPToolDefinition } from '../mcp/types'

export type PipelineStage = 'discover-api' | 'build-mcp' | 'preview-mcp' | 'audit-mcp' | 'deploy-mcp'

export type PipelineStatus =
  | 'running'
  | 'complete'
  | 'failed'
  | 'tool_complete'
  | 'building'
  | 'done'
  | 'retrying'
  | 'finding'
  | 'awaiting-trigger'

export interface ValidateEventData {
  sourceCode?: string
  buildLog?: string
  sandboxUrl?: string
  sandboxId?: string | null
  verifiedTools?: string[]
  toolCount?: number
  errors?: string
}

export interface DeployEventData {
  step?: 'create-repo' | 'push-files' | 'pr-open' | 'await-merge' | 'merged' | 'deploying' | 'live'
  prUrl?: string
  prTitle?: string
  repoUrl?: string
  repoName?: string
  prStatus?: 'open' | 'merged'
  waitMessage?: string
  buildLog?: string
  mcpUrl?: string
  deploymentId?: string
  verifiedTools?: string[]
  error?: string
}

export type AuditSeverity = 'pass' | 'warn' | 'fail'

export interface AuditFinding {
  checkId: string
  title: string
  severity: AuditSeverity
  description: string
  /** Affected tool names — empty array for config-level findings */
  tools: string[]
}

export interface AuditEventData {
  finding?: AuditFinding
  summary?: { pass: number; warn: number; fail: number }
  blocked?: boolean
}

export interface PipelineEvent {
  stage: PipelineStage
  status: PipelineStatus
  data:
    | DiscoveryResult
    | MCPServerConfig
    | MCPToolDefinition
    | ValidateEventData
    | DeployEventData
    | AuditEventData
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
