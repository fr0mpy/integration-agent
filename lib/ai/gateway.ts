import { gateway } from '@ai-sdk/gateway'

export function synthesisModel() {
  return gateway('anthropic/claude-haiku-4.5')
}

export function chatModel() {
  return gateway('anthropic/claude-sonnet-4.6')
}

export function buildTags(
  integrationName: string,
  stage: 'discover' | 'synthesis' | 'validation' | 'config-ui' | 'eval',
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
