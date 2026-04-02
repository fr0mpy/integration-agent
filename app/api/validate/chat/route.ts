import { convertToModelMessages, streamText, stepCountIs } from 'ai'
import type { UIMessage } from 'ai'
import { z } from 'zod'
import { getIntegration } from '@/lib/storage/neon'
import { mcpConfigCache, sourceOverride } from '@/lib/storage/redis'
import { bundleServer } from '@/lib/mcp/bundle'
import { validateSandboxUrl, ValidationError } from '@/lib/validation'
import { errors } from '@/lib/api/response'
import { chatModel } from '@/lib/ai/gateway'
import { prompts, interpolate } from '@/lib/prompts'
import type { MCPServerConfig } from '@/lib/mcp/types'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export const maxDuration = 120

const bodySchema = z.object({
  integrationId: z.string().uuid(),
  sandboxUrl: z.string().url().startsWith('https://').nullish(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    parts: z.array(z.record(z.unknown())).optional(),
    content: z.union([z.string().max(50_000), z.array(z.unknown())]).optional(),
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

    const config = await mcpConfigCache.get(integration.spec_hash) as MCPServerConfig | null

    if (!config) {
      return errors.notFound('Config not cached.')
    }

    const { sourceCode: generatedSource } = bundleServer(config)
    const override = await sourceOverride.get(integrationId)
    const sourceCode = override ?? generatedSource

    const toolSummary = config.tools
      .map((t) => `- ${t.name}: ${t.description} [${t.httpMethod} ${t.httpPath}]`)
      .join('\n')

    const callToolDescription = sandboxUrl
      ? interpolate(prompts.chat.sections!.callToolWithSandbox, { sandboxUrl })
      : prompts.chat.sections!.callToolWithoutSandbox

    const system = interpolate(prompts.chat.systemPrompt, {
      baseUrl: config.baseUrl,
      authMethod: config.authMethod,
      toolCount: String(config.tools.length),
      toolSummary,
      sourceCode,
      callToolDescription,
    })

    const result = streamText({
      model: chatModel(),
      messages: [
        // Cache the static system context (tool list + source code) — same per integration
        {
          role: 'user',
          content: [{
            type: 'text',
            text: system,
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral' } },
            },
          }],
        },
        { role: 'assistant', content: prompts.chat.sections!.assistantAck },
        ...await convertToModelMessages(messages as unknown as UIMessage[]),
      ],
      stopWhen: stepCountIs(10),
      tools: {
        listTools: {
          description: 'List all MCP tools available in this generated server with their names, titles, and descriptions',
          inputSchema: z.object({}),
          execute: async () => {
            return config.tools.map((t) => ({
              name: t.name,
              title: t.title,
              description: t.description,
              method: t.httpMethod,
              path: t.httpPath,
              authRequired: t.authRequired,
            }))
          },
        },

        readTool: {
          description: 'Get the full definition of a specific MCP tool including its input schema, HTTP mapping, and auth requirements',
          inputSchema: z.object({
            toolName: z.string().describe('The exact tool name (e.g. petstore_listPets)'),
          }),
          execute: async ({ toolName }) => {
            const tool = config.tools.find((t) => t.name === toolName)

            if (!tool) {
              return { error: `Tool "${toolName}" not found. Available: ${config.tools.map((t) => t.name).join(', ')}` }
            }

            return {
              name: tool.name,
              title: tool.title,
              description: tool.description,
              httpMethod: tool.httpMethod,
              httpPath: tool.httpPath,
              authRequired: tool.authRequired,
              inputSchema: tool.inputSchema,
            }
          },
        },

        callTool: {
          description: 'Call a specific MCP tool against the live sandbox with provided arguments and return the real API response',
          inputSchema: z.object({
            toolName: z.string().describe('The exact tool name to call'),
            args: z.record(z.unknown()).describe('Arguments to pass to the tool matching its input schema'),
          }),
          execute: async ({ toolName, args }) => {
            if (!sandboxUrl) {
              return { error: 'No sandbox URL available. The sandbox runs only during pipeline validation. Re-run the pipeline to get a live sandbox.' }
            }

            const validNames = config.tools.map((t) => t.name)

            if (!validNames.includes(toolName)) {
              return { error: `Tool "${toolName}" not found. Available: ${validNames.join(', ')}` }
            }

            const client = new Client({ name: 'integration-agent-chat', version: '1.0.0' })
            const transport = new StreamableHTTPClientTransport(new URL(`${sandboxUrl}/mcp`))

            try {
              await client.connect(transport)
              const result = await client.callTool({ name: toolName, arguments: args })
              return { ok: true, result: result.content }
            } catch (err) {
              return { ok: false, error: err instanceof Error ? err.message : String(err) }
            } finally {
              await client.close().catch((e: unknown) => console.warn('MCP client close failed:', e instanceof Error ? e.message : 'unknown'))
            }
          },
        },
      },
    })

    return result.toUIMessageStreamResponse({
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
