import { generateText, Output } from 'ai'
import { synthesisModel, buildTags } from '../ai/gateway'
import { prompts, buildSystemPrompt } from '../prompts'
import { buildSynthesisPrompt } from '../prompts/builders/synthesis'
import { MCPServerConfigSchema, type MCPServerConfig } from '../mcp/types'
import type { DiscoveryResult } from './discover'

const MAX_RETRIES = 2

/**
 * Stage 2 — Synthesis.
 * Converts discovered endpoints into MCP tool definitions using
 * generateText + Output.object() via AI Gateway.
 */
export async function synthesiseTools(
  discovered: DiscoveryResult,
  buildErrors?: string,
): Promise<MCPServerConfig> {
  let userPrompt = buildSynthesisPrompt(discovered)

  if (buildErrors) {
    userPrompt += `\n\nPREVIOUS SANDBOX BUILD ERRORS — fix these in the generated tool handlers:\n${buildErrors}`
  }

  let lastError: string | null = null

  const safeName = discovered.apiName.replace(/[\x00-\x1F\x7F]/g, '')
  console.log(`[Synthesis] Starting for "${safeName}" (${discovered.endpointCount} endpoints)`)

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const prompt = lastError
      ? `${userPrompt}\n\nPrevious attempt failed validation with these errors:\n${lastError}\n\nPlease fix the issues and try again.`
      : userPrompt

    const tags = buildTags(discovered.apiName, 'synthesis', attempt > 0 ? `retry-${attempt}` : undefined)
    console.log(`[Synthesis] Attempt ${attempt + 1}/${MAX_RETRIES + 1} for "${safeName}"`, { tags })

    try {
      const { output } = await generateText({
        model: synthesisModel(),
        system: buildSystemPrompt(prompts.synthesis),
        prompt,
        output: Output.object({ schema: MCPServerConfigSchema }),
        providerOptions: {
          gateway: { tags },
        },
      })

      if (!output) {
        lastError = 'Model returned no structured output'
        console.warn(`[Synthesis] Attempt ${attempt + 1}/${MAX_RETRIES + 1}: null output`)
        continue
      }

      console.log(`[Synthesis] Success on attempt ${attempt + 1} — ${output.tools.length} tools generated`)
      return output
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Unknown error during synthesis'
      console.warn(`[Synthesis] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, lastError)

      if (err instanceof Error && err.cause) {
        console.warn('[Synthesis] Cause:', err.cause)
      }
    }
  }

  console.error(`[Synthesis] All ${MAX_RETRIES + 1} attempts exhausted for "${discovered.apiName}"`)
  throw new Error(
    `Synthesis failed after ${MAX_RETRIES + 1} attempts. Last error: ${lastError}`,
  )
}
