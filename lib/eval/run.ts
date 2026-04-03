/**
 * Synthesis Eval — CLI runner
 *
 * Usage:
 *   npx tsx lib/eval/run.ts
 *
 * Runs synthesis against frozen API fixtures and scores the output
 * on 6 deterministic rubric dimensions. Use this to catch regressions
 * when prompts, models, or schemas change.
 */

import { synthesiseTools } from '../pipeline/synthesise'
import { ALL_FIXTURES } from './fixtures'
import { scoreFixture, type EvalResult } from './rubric'

// ── Colours ──────────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
}

// Returns a coloured ANSI badge string for a score value; used to make pass/warn/fail visually distinct in CLI output.
function badge(score: 'pass' | 'warn' | 'fail'): string {
  const map = {
    pass: `${c.green}● pass${c.reset}`,
    warn: `${c.yellow}● warn${c.reset}`,
    fail: `${c.red}● fail${c.reset}`,
  }
  return map[score]
}

// Prints a formatted per-fixture result block to stdout, showing the overall score and each dimension's badge and detail.
function printResult(result: EvalResult): void {
  const overallColour = result.overall === 'pass' ? c.green : result.overall === 'warn' ? c.yellow : c.red
  console.log(`\n${c.bold}${result.fixture}${c.reset}  ${overallColour}${result.overall.toUpperCase()}${c.reset}  ${c.dim}${result.toolCount} tools · ${(result.durationMs / 1000).toFixed(1)}s${c.reset}`)
  console.log(`${'─'.repeat(60)}`)

  for (const s of result.scores) {
    const label = s.label.padEnd(18)
    console.log(`  ${badge(s.score)}  ${c.white}${label}${c.reset}${c.dim}${s.detail}${c.reset}`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

// CLI entry point: runs synthesis on every fixture, scores results, prints a summary, and exits non-zero if any fixture fails.
async function main(): Promise<void> {
  console.log(`\n${c.bold}${c.cyan}Synthesis Eval${c.reset}`)
  console.log(`${c.dim}Evaluates: prompt · model · schema constraints${c.reset}`)
  console.log(`${c.dim}Fixtures: ${ALL_FIXTURES.map((f) => f.name).join(', ')}${c.reset}`)
  console.log(`${c.dim}Rubric: 6 deterministic dimensions, no LLM-as-judge${c.reset}\n`)

  const results: EvalResult[] = []

  for (const fixture of ALL_FIXTURES) {
    process.stdout.write(`Running ${c.bold}${fixture.name}${c.reset}...`)
    const start = Date.now()

    try {
      const config = await synthesiseTools(fixture.discovery)
      const durationMs = Date.now() - start
      process.stdout.write(` done (${(durationMs / 1000).toFixed(1)}s)\n`)
      results.push(scoreFixture(config, fixture, durationMs))
    } catch (err) {
      const durationMs = Date.now() - start
      process.stdout.write(` ${c.red}FAILED${c.reset} (${(durationMs / 1000).toFixed(1)}s)\n`)
      console.error(`  ${c.red}${err instanceof Error ? err.message : 'unknown error'}${c.reset}`)
      results.push({
        fixture: fixture.name,
        scores: [
          { dimension: 'hallucination', label: 'Hallucination', score: 'fail', detail: 'Synthesis failed — no output to score' },
          { dimension: 'coverage', label: 'Coverage', score: 'fail', detail: 'Synthesis failed — no output to score' },
          { dimension: 'auth', label: 'Auth Fidelity', score: 'fail', detail: 'Synthesis failed — no output to score' },
          { dimension: 'schema', label: 'Schema Quality', score: 'fail', detail: 'Synthesis failed — no output to score' },
          { dimension: 'naming', label: 'Naming', score: 'fail', detail: 'Synthesis failed — no output to score' },
          { dimension: 'security', label: 'Security', score: 'fail', detail: 'Synthesis failed — no output to score' },
        ],
        overall: 'fail',
        toolCount: 0,
        durationMs,
      })
    }
  }

  // Print results
  for (const result of results) {
    printResult(result)
  }

  // Summary
  const passing = results.filter((r) => r.overall === 'pass').length
  const total = results.length
  const allPass = passing === total

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`${c.bold}Summary${c.reset}  ${allPass ? c.green : c.red}${passing}/${total} fixtures passing${c.reset}`)

  if (!allPass) {
    console.log(`${c.dim}Fix failing dimensions before changing prompts or swapping models.${c.reset}`)
    process.exit(1)
  }

  console.log(`${c.dim}All fixtures pass. Baseline established.${c.reset}\n`)
}

main().catch((err) => {
  console.error(`${c.red}Eval runner error:${c.reset}`, err)
  process.exit(1)
})
