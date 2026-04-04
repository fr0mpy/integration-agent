// Chat validation route — streams agent responses with 3 tools (list, read, call) against the live sandbox MCP server
import { createAgentUIStreamResponse } from 'ai'
import { z } from 'zod'
import { getIntegration } from '@/lib/storage/neon'
import { mcpConfigCache, sourceOverride } from '@/lib/storage/redis'
import { bundleServer } from '@/lib/mcp/bundle'
import { validateSandboxUrl, ValidationError } from '@/lib/validation'
import { errors } from '@/lib/api/response'
import { BUILD_VERSION } from '@/lib/config'
import { prompts, interpolate, buildSystemPrompt } from '@/lib/prompts'
import type { MCPServerConfig } from '@/lib/mcp/types'
import { createChatAgent } from '@/lib/ai/chat-agent'

export const maxDuration = 120

// Validate shape of incoming chat messages — caps array sizes to bound token cost
const bodySchema = z.object({
  integrationId: z.string().uuid(),
  sandboxUrl: z.string().url().startsWith('https://').nullish(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    parts: z.array(z.object({ type: z.string(), text: z.string().max(50_000).optional() })).max(50).optional(),
    content: z.union([z.string().max(50_000), z.array(z.object({ type: z.string(), text: z.string().max(50_000).optional() })).max(50)]).optional(),
  })).max(100),
})

export async function POST(req: Request) {
  try {
    const raw = await req.json()
    const parsed = bodySchema.safeParse(raw)

    if (!parsed.success) {
      return errors.badRequest('Invalid request.')
    }

    const { messages, integrationId, sandboxUrl } = parsed.data

    console.log(`[v${BUILD_VERSION}] chat/route: integrationId=${integrationId} sandboxUrl=${sandboxUrl ?? 'NONE'} messageCount=${messages.length}`)

    // SSRF guard: validate sandboxUrl resolves to a public IP
    if (sandboxUrl) {
      try {
        await validateSandboxUrl(sandboxUrl)
      } catch (err) {
        return errors.badRequest(err instanceof ValidationError ? err.message : 'Invalid sandbox URL.')
      }
    }

    const integration = await getIntegration(integrationId)

    if (!integration) {
      return errors.notFound('Integration not found.')
    }

    // Try Redis first, fall back to Postgres (Redis writes are unreliable inside WDK steps)
    let config = await mcpConfigCache.get(integration.spec_hash) as MCPServerConfig | null

    if (!config && integration.config_json) {
      console.log(`[v${BUILD_VERSION}] chat/route: Redis miss, using Postgres config_json`)
      config = integration.config_json as MCPServerConfig
    }

    console.log(`[v${BUILD_VERSION}] chat/route: config found=${!!config} spec_hash=${integration.spec_hash?.slice(0, 12)} toolCount=${config?.tools?.length ?? 0}`)

    if (!config) {
      console.error(`[v${BUILD_VERSION}] chat/route: CONFIG NOT FOUND — spec_hash=${integration.spec_hash} status=${integration.status}`)
      return errors.notFound('Config not cached.')
    }

    // Build system prompt context — source override allows sandbox edits to persist into chat
    const { sourceCode: generatedSource } = bundleServer(config)
    const override = await sourceOverride.get(integrationId)
    const sourceCode = override ?? generatedSource

    const toolSummary = config.tools
      .map((t) => `- ${t.name}: ${t.description} [${t.httpMethod} ${t.httpPath}]`)
      .join('\n')

    const callToolDescription = sandboxUrl
      ? interpolate(prompts.chat.snippets!.callToolWithSandbox, { sandboxUrl })
      : prompts.chat.snippets!.callToolWithoutSandbox

    const system = interpolate(buildSystemPrompt(prompts.chat), {
      baseUrl: config.baseUrl,
      authMethod: config.authMethod,
      toolCount: String(config.tools.length),
      toolSummary,
      sourceCode,
      callToolDescription,
    })

    const agent = createChatAgent({
      sandboxUrl: sandboxUrl ?? null,
      mcpConfig: config,
      integrationName: integration.name ?? integrationId,
      system,
    })

    return createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
      onError: (err) => {
        console.error('Chat stream error:', err instanceof Error ? err.message : 'unknown')
        return 'An error occurred. Please try again.'
      },
    })
  } catch (err) {
    console.error('Chat route error:', err instanceof Error ? err.message : 'unknown')
    return errors.internal()
  }
}
