export interface PromptDefinition {
  id: string
  name: string
  description: string
  model: 'haiku' | 'sonnet'
  systemPrompt: string
  sections?: Record<string, string>
}
