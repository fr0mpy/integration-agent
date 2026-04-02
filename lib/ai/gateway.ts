import { gateway } from '@ai-sdk/gateway'
import { config } from '../config'

// Returns the AI Gateway model handle for discovery and synthesis steps (Haiku); cheaper model used for high-volume structured extraction.
export function synthesisModel() {
  return gateway(config.models.synthesis)
}

// Returns the AI Gateway model handle for chat, audit, and validation steps (Sonnet); higher-capability model used for reasoning-heavy tasks.
export function chatModel() {
  return gateway(config.models.chat)
}

// Constructs the AI Gateway cost-tracking tags array for a given integration and pipeline stage; used to attribute model spend by integration in the Gateway dashboard.
export function buildTags(
  integrationName: string,
  stage: 'discover' | 'synthesis' | 'validation' | 'config-ui' | 'eval' | 'audit',
  extra?: string
): string[] {
  const tags: string[] = [
    `integration:${integrationName}`,
    `stage:${stage}`,
  ]

  if (extra) {
    tags.push(`detail:${extra}`)
  }

  return tags
}
