import { ToolLoopAgent, stepCountIs, tool } from 'ai'
import type { InferAgentUIMessage } from 'ai'
import { z } from 'zod'
import { chatModel, buildTags } from './gateway'
import { config } from '../config'
import type { MCPServerConfig } from '../mcp/types'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

interface ChatAgentContext {
  sandboxUrl: string | null
  mcpConfig: MCPServerConfig
  integrationName: string
  system: string
}

export function createChatAgent(ctx: ChatAgentContext) {
  // Normalize sandboxUrl to origin to prevent path/query injection into MCP transport URL
  const sandboxOrigin = ctx.sandboxUrl ? new URL(ctx.sandboxUrl).origin : null
  const tags = buildTags(ctx.integrationName, 'chat')

  return new ToolLoopAgent({
    model: chatModel(),
    instructions: ctx.system,
    temperature: config.ai.chat.temperature,
    maxOutputTokens: config.ai.chat.maxOutputTokens,
    stopWhen: stepCountIs(10),
    providerOptions: {
      gateway: { tags },
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'chat-validation',
      metadata: { tags },
    },
    tools: {
      listTools: tool({
        description: 'List all MCP tools available in this generated server with their names, titles, and descriptions',
        inputSchema: z.object({}),
        execute: async () => {
          if (sandboxOrigin) {
            const client = new Client({ name: 'integration-agent-chat', version: '1.0.0' })
            const transport = new StreamableHTTPClientTransport(new URL(`${sandboxOrigin}/mcp`))

            try {
              await client.connect(transport)
              const result = await client.listTools()
              return result.tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              }))
            } catch (err) {
              return { error: `Sandbox unreachable: ${err instanceof Error ? err.message : String(err)}` }
            } finally {
              await client.close().catch((err) => console.warn('MCP client close failed:', err instanceof Error ? err.message : 'unknown'))
            }
          }

          return ctx.mcpConfig.tools.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            method: t.httpMethod,
            path: t.httpPath,
            authRequired: t.authRequired,
          }))
        },
      }),

      readTool: tool({
        description: 'Get the full definition of a specific MCP tool including its input schema, HTTP mapping, and auth requirements',
        inputSchema: z.object({
          toolName: z.string().describe('The exact tool name (e.g. get_pet_by_id)'),
        }),
        execute: async ({ toolName }) => {
          if (sandboxOrigin) {
            const client = new Client({ name: 'integration-agent-chat', version: '1.0.0' })
            const transport = new StreamableHTTPClientTransport(new URL(`${sandboxOrigin}/mcp`))

            try {
              await client.connect(transport)
              const result = await client.listTools()
              const found = result.tools.find((t) => t.name === toolName)

              if (!found) {
                const available = result.tools.map((t) => t.name).join(', ')
                return { error: `Tool "${toolName}" not found in sandbox. Available: ${available}` }
              }

              return { name: found.name, description: found.description, inputSchema: found.inputSchema }
            } catch (err) {
              return { error: `Sandbox unreachable: ${err instanceof Error ? err.message : String(err)}` }
            } finally {
              await client.close().catch((err) => console.warn('MCP client close failed:', err instanceof Error ? err.message : 'unknown'))
            }
          }

          const found = ctx.mcpConfig.tools.find((t) => t.name === toolName)

          if (!found) {
            return { error: `Tool "${toolName}" not found. Available: ${ctx.mcpConfig.tools.map((t) => t.name).join(', ')}` }
          }

          return {
            name: found.name,
            title: found.title,
            description: found.description,
            httpMethod: found.httpMethod,
            httpPath: found.httpPath,
            authRequired: found.authRequired,
            inputSchema: found.inputSchema,
          }
        },
      }),

      callTool: tool({
        description: 'Call a specific MCP tool against the live sandbox with provided arguments and return the real API response',
        inputSchema: z.object({
          toolName: z.string().describe('The exact tool name to call'),
          args: z.record(z.unknown()).describe('Arguments to pass to the tool matching its input schema'),
        }),
        execute: async ({ toolName, args }) => {
          if (!sandboxOrigin) {
            return { error: 'No sandbox URL available. The sandbox runs only during pipeline validation. Re-run the pipeline to get a live sandbox.' }
          }

          const client = new Client({ name: 'integration-agent-chat', version: '1.0.0' })
          const transport = new StreamableHTTPClientTransport(new URL(`${sandboxOrigin}/mcp`))

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
      }),
    },
  })
}

export type ChatAgent = ReturnType<typeof createChatAgent>
export type ChatAgentUIMessage = InferAgentUIMessage<ChatAgent>
