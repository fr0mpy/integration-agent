import type { PromptDefinition } from './types'
import synthesisPrompt from './synthesis.json'
import auditPrompt from './audit.json'
import chatPrompt from './chat.json'
import enrichmentPrompt from './enrichment.json'

export const prompts = {
  synthesis: synthesisPrompt as PromptDefinition,
  audit: auditPrompt as PromptDefinition,
  chat: chatPrompt as PromptDefinition,
  enrichment: enrichmentPrompt as PromptDefinition,
} as const

export { type PromptDefinition } from './types'

// Assembles a prompt's sections into a system prompt string using XML tags.
export function buildSystemPrompt(prompt: PromptDefinition): string {
  return Object.entries(prompt.sections)
    .map(([key, content]) => `<${key}>\n${content}\n</${key}>`)
    .join('\n\n')
}

// Replaces {{key}} placeholders in a prompt template string with values from the vars map.
export function interpolate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}
