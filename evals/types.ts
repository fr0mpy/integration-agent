import type { MCPServerConfig } from '../lib/mcp/types'

// ── Golden-set expectations ──────────────────────────────────────────────────

export interface GoldenExpectation {
  /** Tool names that MUST appear in synthesis output */
  requiredTools: string[]
  /** Tool names that MUST NOT appear (hallucination canaries) */
  forbiddenTools: string[]
  /** For key tools, the expected httpMethod + httpPath */
  expectedMappings: Record<string, { httpMethod: string; httpPath: string }>
  minTools: number
  maxTools: number
  authMethod: string
  /** Tools that must have a composedOf array with >= 2 entries */
  composedTools: string[]
}

// ── LLM-as-judge ─────────────────────────────────────────────────────────────

export interface ScoredTool {
  name: string
  clarity: number
  actionability: number
  faithfulness: number
  feedback: string
}

export interface JudgeResult {
  tools: ScoredTool[]
  overall: number
}

// ── Per-fixture result ───────────────────────────────────────────────────────

export interface GoldenCheckResult {
  passed: boolean
  total: number
  failures: string[]
}

export interface FixtureResult {
  fixture: string
  toolCount: number
  valid: boolean
  golden: GoldenCheckResult
  judge: JudgeResult | null
  status: 'pass' | 'fail'
}

// ── Security eval ────────────────────────────────────────────────────────────

export interface SecurityEvalCase {
  name: string
  config: MCPServerConfig
  expectedCheckId: string
  expectedSeverity: 'fail' | 'warn'
}

export interface SecurityEvalResult {
  name: string
  passed: boolean
  detail: string
}

// ── Top-level ────────────────────────────────────────────────────────────────

export interface EvalReport {
  fixtures: FixtureResult[]
  security: SecurityEvalResult[]
  avgJudgeScore: number
  passed: boolean
}
