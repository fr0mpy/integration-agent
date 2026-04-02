export interface PromptDefinition {
  id: string
  name: string
  description: string
  model: 'haiku' | 'sonnet'
  version: string
  sections: Record<string, string>
  snippets?: Record<string, string>
}
