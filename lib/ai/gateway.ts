import { gateway } from '@ai-sdk/gateway'

export function synthesisModel() {
  return gateway('anthropic/claude-haiku-4-5')
}

export function validationModel() {
  return gateway('anthropic/claude-sonnet-4-6')
}

export function buildTags(
  integrationName: string,
  stage: 'synthesis' | 'validation' | 'config-ui' | 'eval',
  extra?: string
): Record<string, string> {
  const tags: Record<string, string> = {
    integration: integrationName,
    stage,
  }
  if (extra) {
    tags.detail = extra
  }
  return tags
}
