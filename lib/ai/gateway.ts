import { gateway } from '@ai-sdk/gateway'
import { config } from '../config'

export function synthesisModel() {
  return gateway(config.models.synthesis)
}

export function chatModel() {
  return gateway(config.models.chat)
}

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
