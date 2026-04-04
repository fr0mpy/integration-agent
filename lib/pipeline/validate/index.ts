import type { MCPServerConfig } from '../../mcp/types'
import type { DiscoveryResult } from '../discover'

export interface ToolValidationError {
  tool: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  toolCount: number
  errors: ToolValidationError[]
}

/**
 * Stage 3 — Structural validation.
 * Pure TypeScript, no LLM calls. Fast exit gate before codegen + sandbox.
 *
 * Checks:
 * 1. No duplicate tool names
 * 2. Every httpPath exists in the original spec's paths
 * 3. Required params are a subset of defined properties
 * 4. Auth-required tools have an authHeader when authMethod !== 'none'
 */
export function validateConfig(
  config: MCPServerConfig,
  discovery: DiscoveryResult,
): ValidationResult {
  const errors: ToolValidationError[] = []

  // 1. No duplicate tool names
  const seen = new Set<string>()

  for (const tool of config.tools) {
    if (seen.has(tool.name)) {
      errors.push({ tool: tool.name, message: `Duplicate tool name "${tool.name}"` })
    }

    seen.add(tool.name)
  }

  // Build a set of known spec paths for O(1) lookup
  const specPaths = new Set(discovery.endpoints.map((e) => e.path))

  for (const tool of config.tools) {
    // 2. httpPath must exist in the discovered spec
    if (!specPaths.has(tool.httpPath)) {
      errors.push({
        tool: tool.name,
        message: `httpPath "${tool.httpPath}" not found in spec (tool: ${tool.name})`,
      })
    }

    // 3. Required params must be defined in inputSchema.properties
    const definedProps = new Set(Object.keys(tool.inputSchema.properties))

    for (const req of tool.inputSchema.required) {
      if (!definedProps.has(req)) {
        errors.push({
          tool: tool.name,
          message: `Required param "${req}" not in inputSchema.properties (tool: ${tool.name})`,
        })
      }
    }

    // 4. Auth-required tools need an authHeader
    if (tool.authRequired && config.authMethod !== 'none' && !config.authHeader) {
      errors.push({
        tool: tool.name,
        message: `Tool "${tool.name}" requires auth but config has no authHeader`,
      })
    }

    // 5. Composed tool sub-endpoints must exist in spec
    if (tool.composedOf) {
      const definedProps = new Set(Object.keys(tool.inputSchema.properties))

      for (const sub of tool.composedOf) {
        if (!specPaths.has(sub.httpPath)) {
          errors.push({
            tool: tool.name,
            message: `Composed sub-endpoint "${sub.httpMethod} ${sub.httpPath}" not found in spec (tool: ${tool.name})`,
          })
        }

        // Validate paramMapping references existing input params
        for (const toolParam of Object.keys(sub.paramMapping)) {
          if (!definedProps.has(toolParam)) {
            errors.push({
              tool: tool.name,
              message: `Composed paramMapping references unknown input param "${toolParam}" (tool: ${tool.name})`,
            })
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    toolCount: config.tools.length,
    errors,
  }
}
