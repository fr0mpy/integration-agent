# Integration Agent

Paste an OpenAPI spec URL. Get a deployed MCP server in minutes.

**Live demo:** https://api-integration-agent-el-frompos-projects.vercel.app

---

## Contents

- [The Problem](#the-problem)
- [How It Works](#how-it-works)
- [Why These Tools](#why-these-tools)
- [Tech Stack](#tech-stack)
- [Security](#security)
- [Testing & Evaluation](#testing--evaluation)
- [Local Setup](#local-setup)
- [Project Structure](#project-structure)
- [CI/CD](#cicd)
- [Generated MCP Servers](#generated-mcp-servers)

---

## The Problem

Every API an AI agent needs to call requires the same work: parse the spec, write tool definitions, handle auth, validate the output, deploy and monitor. For platform teams connecting dozens of APIs, that's weeks of boilerplate.

Integration Agent automates the full pipeline. You give it an OpenAPI spec URL, and it discovers endpoints, generates [MCP](https://modelcontextprotocol.io) tool definitions, validates them in a sandbox, runs a security audit, and deploys a production MCP server — all without writing code.

---

## How It Works

| # | Stage | What happens | Key file |
|---|-------|-------------|----------|
| 1 | **Discovery** | Parses the OpenAPI spec, extracts endpoints, parameters, auth, and schemas. If the spec has >50 endpoints or vague summaries, a Haiku call enriches and filters it. | `lib/pipeline/discover.ts` |
| 2 | **Synthesis** | Claude Haiku generates MCP tool definitions optimised for LLM consumption. Structured output via `Output.object()` + Zod schema. Retries up to 3 times with error context. | `lib/pipeline/synthesise.ts` |
| 3 | **Validation** | Generated TypeScript is written into a Vercel Sandbox (Firecracker VM), built with npm, started, and verified via live MCP `listTools()` calls. Build failures are fed back to synthesis for a retry. | `lib/pipeline/sandbox-check.ts` |
| 4 | **Security Audit** | 7 deterministic checks (SSRF, path traversal, hallucinated endpoints, missing auth on writes) run first. Then Claude Sonnet with extended thinking runs 3 AI-assisted checks (parameter injection, sensitive data exposure, destructive operations). Any `fail` blocks deployment. | `lib/pipeline/security-audit.ts` |
| 5 | **Deploy** | Generated files are pushed to a GitHub monorepo via the Git Trees API. A PR is opened, the workflow suspends until merge, then a Vercel project is created and polled until live. | `lib/pipeline/deploy/` |

The pipeline is a [Workflow DevKit](https://vercel.com/docs/workflow) durable workflow — it survives crashes and restarts, pauses for user approval at two points (tool review before build, audit review before deploy), and resumes from the exact step that was interrupted.

---

## Why These Tools

Every tool here was chosen for a specific reason, not just familiarity.

| Choice | Why |
|--------|-----|
| **[Workflow DevKit](https://vercel.com/docs/workflow)** | The pipeline takes minutes and involves external waits (sandbox build, PR merge, deployment). WDK makes it durable — survives crashes, resumes from the exact step, and supports human-in-the-loop approval gates via `createHook()`. Without it, a dropped connection means starting over. |
| **[Fluid Compute](https://vercel.com/docs/functions/fluid-compute)** | The pipeline spends most of its time waiting on AI responses, npm install in sandbox, and PR merge. Fluid Compute charges for active CPU time, not wall-clock time. That's the right cost model for I/O-heavy workflows — we're not paying to wait. |
| **[Vercel Sandbox](https://vercel.com/docs/sandbox)** | Generated code must be tested before deploy. Sandbox gives us isolated Firecracker microVMs — no risk to the host, no shared state, disposable after each run. We boot a VM, build the server, call `listTools()` to verify it works, and tear it down. |
| **[AI Gateway](https://vercel.com/docs/ai-gateway)** | All LLM calls route through one endpoint. We get OIDC auth (no API keys in environment variables), cost tracking via tags (`stage:synthesis` vs `stage:audit`), and provider failover without changing call sites. |
| **[Zod](https://zod.dev)** | Three roles in one library: (1) validate LLM structured output via AI SDK's `Output.object()`, (2) injection guards via `.refine()` on httpPaths — rejecting backticks, `${`, path traversal, (3) runtime config validation before codegen. Schema definition and security in one place. |
| **[Upstash Redis](https://upstash.com)** | 30-day config/discovery cache avoids re-synthesis when the same spec is submitted twice. Distributed lock prevents concurrent synthesis races. Rate limiting is fail-closed — if Redis is unreachable, requests are denied, not allowed through. |
| **[Neon Postgres](https://neon.tech)** | Relational storage for integration records and encrypted credentials. The serverless HTTP driver works in Vercel functions without connection pooling setup. |
| **Layered security audit** | 7 deterministic checks run first — fast, free, and catches most issues (SSRF, path traversal, hallucinated endpoints). AI-assisted checks (Sonnet with extended thinking) handle semantic issues like parameter injection. The deterministic layer avoids burning tokens on problems a regex can catch. Any `fail` blocks deploy. |
| **[Vercel SDK](https://github.com/vercel/sdk) + [Octokit](https://github.com/octokit/rest.js)** | Programmatic project creation, env var injection, and deployment polling. The full deploy pipeline (PR → merge → live URL) runs without manual steps. |

---

## Tech Stack

**Framework:** Next.js 16 (App Router, Turbopack, Fluid Compute), Tailwind CSS v4, shadcn/ui, Geist

**AI:** [AI SDK v6](https://sdk.vercel.ai) (`generateText`, `streamText`, `Output.object()`, tool calling) → [AI Gateway](https://vercel.com/docs/ai-gateway) (OIDC, cost tags, failover)
- Claude Haiku 4.5 — discovery enrichment + synthesis (fast, low-cost)
- Claude Sonnet 4.6 — security audit (reasoning) + validation chat (tool calling)

**Durable execution:** [Workflow DevKit](https://vercel.com/docs/workflow) — `'use workflow'`, `'use step'`, `createHook()`, `createWebhook()`

**Sandbox:** [Vercel Sandbox](https://vercel.com/docs/sandbox) — on-demand Firecracker VMs

**Storage:** [Neon Postgres](https://neon.tech) (integration records, encrypted credentials) · [Upstash Redis](https://upstash.com) (config cache, distributed locks, rate limiting)

**Deploy automation:** [Vercel SDK](https://github.com/vercel/sdk) (project creation, env vars, deployment polling) · [Octokit](https://github.com/octokit/rest.js) (PR creation, Git Trees API, webhooks)

---

## Security

| Layer | Implementation |
|-------|---------------|
| **SSRF protection** | DNS resolution before any outbound fetch; private IP ranges (`127.x`, `10.x`, `192.168.x`, `169.254.x`) blocked |
| **Credential encryption** | AES-256-GCM at rest (random IV, auth tag); retrieved only via HMAC-verified requests using `timingSafeEqual` |
| **Injection guards** | Zod `.refine()` on all httpPaths — rejects backticks, `${`, `..`, null bytes, CRLF |
| **Rate limiting** | Upstash sliding window (10 req/min/IP), fail-closed — denies if Redis is unavailable |
| **Security headers** | CSP, HSTS, X-Frame-Options (`DENY`), X-Content-Type-Options (`nosniff`) in `next.config.ts` |
| **Distributed lock** | Redis lock prevents concurrent synthesis for the same spec |
| **Audit gate** | 7 deterministic + 3 AI-assisted security checks; any `fail` blocks deployment |

---

## Testing & Evaluation

```bash
npm test        # unit tests — mocked AI, DNS, Redis, Sandbox
npm run eval    # synthesis eval — real LLM calls via AI Gateway
```

**Unit tests (97 across 9 files):** cover encryption, validation, spec parsing, AI synthesis, sandbox checks, code generation, and Redis caching. All external dependencies are mocked — tests are fast and deterministic.

**Synthesis eval:** runs the synthesis stage against frozen `DiscoveryResult` fixtures (a CRUD API with bearer auth, a read-only API with API key auth) and scores the output on six deterministic dimensions:

| Dimension | What it checks |
|-----------|---------------|
| Hallucination | All tool httpPaths exist in the source spec |
| Coverage | % of spec endpoints that got a tool |
| Auth Fidelity | Output preserves auth method and base URL |
| Schema Quality | Required path params appear in tool inputSchema |
| Naming | Tool names are descriptive, not generic |
| Security | No path traversal, auth on write methods, reasonable scope |

The rubric is deterministic — no LLM-as-judge. Eval runs are tagged `stage:eval` in AI Gateway for cost tracking separate from production traffic.

---

## Local Setup

```bash
git clone https://github.com/fr0mpy/integration-agent
cd integration-agent
npm install
cp .env.local.example .env.local
# fill in required env vars (see table below)
npm run dev
```

The app runs at `http://localhost:3000`.

> **Note:** The UI and discovery stage work without `VERCEL_TOKEN` or `GITHUB_TOKEN`, but deployment will fail without them.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic key — routes through AI Gateway |
| `AI_GATEWAY_URL` | Yes | AI Gateway base URL |
| `VERCEL_TOKEN` | Yes | Vercel REST API token for project + deployment management |
| `VERCEL_TEAM_ID` | Yes | Team scope for created Vercel projects |
| `DATABASE_URL` | Yes | Neon Postgres connection string |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST token |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key (32-byte hex string) |
| `CREDENTIAL_HMAC_SECRET` | Yes | Shared secret for deployed servers to verify credential requests |
| `NEXT_PUBLIC_APP_URL` | Yes | Base URL of this app (`http://localhost:3000` locally) |
| `OPENAI_API_KEY` | No | Optional AI Gateway fallback provider |

**Runtime credentials** (entered by users in the UI, not build-time):
- `GITHUB_TOKEN` — required to create the deployment monorepo and open PRs
- Per-API credentials (e.g., API keys for the target API) — stored encrypted in Neon

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm test` | Vitest unit tests — 97 tests across 9 files |
| `npm run eval` | Synthesis eval — real LLM calls against frozen fixtures |
| `npm run lint` | ESLint |

---

## Project Structure

```
app/                        Next.js routes
├── page.tsx                Landing page — spec input + recent integrations
├── integrate/[id]/         Pipeline view — SSE-driven stage UI
└── api/
    ├── pipeline/[id]/      Trigger + SSE stream for pipeline execution
    ├── integrate/[id]/     Per-integration actions (build, audit, credentials, files, sandbox)
    ├── synthesise/         Standalone synthesis endpoint
    └── validate/chat/      Chat endpoint (streaming, with live sandbox tool calling)

lib/
├── pipeline/               Core pipeline logic
│   ├── index.ts            synthesisePipeline() — main durable workflow
│   ├── discover.ts         Stage 1: OpenAPI parsing + AI enrichment
│   ├── synthesise.ts       Stage 2: MCP tool generation
│   ├── sandbox-check.ts    Stage 3: Sandbox build + MCP verification
│   ├── security-audit.ts   Stage 4: Deterministic + AI security checks
│   └── deploy/             Stage 5: GitHub PR + Vercel project creation
├── ai/gateway.ts           synthesisModel(), chatModel(), buildTags()
├── mcp/                    Code generation + Zod schemas
├── prompts/                System prompts (JSON) + builders
├── storage/                Neon Postgres + Upstash Redis wrappers
├── eval/                   Synthesis evaluation harness
├── crypto.ts               AES-256-GCM encryption
├── validation.ts           UUID + SSRF + IP range validation
└── config.ts               Model names, SSE config, env keys

components/
├── pipeline/               Stage-specific UI panels
├── SpecInput.tsx           Spec URL submission
└── ui/                     shadcn/ui base components

generated-server-template/  Template files for codegen output
hooks/use-pipeline.ts       SSE client with lastIndex reconnect + DB fallback
```

---

## CI/CD

GitHub Actions (`.github/workflows/deploy.yml`):

- **On PR:** lint → test → preview deploy → URL commented on PR
- **On push to main:** lint → test → production deploy

Build uses `vercel build` + `vercel deploy --prebuilt` for reproducibility.

Required GitHub Actions secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

---

## Generated MCP Servers

Each successful pipeline produces a minimal Next.js app deployed to its own Vercel project:

```
app/[transport]/route.ts    MCP handler (supports SSE + streamable-http)
package.json                Minimal deps: next, mcp-handler, zod
next.config.ts              Minimal config
vercel.json                 fluid: true, 300s max duration
```

Tools are generated from the OpenAPI spec. On each request, the server fetches credentials via an HMAC-verified call back to this app — credentials are never stored in the deployed server itself.

Each server is an independent Vercel project scoped to a `mcps/{integrationId}/` subdirectory of the deployment monorepo. Scales to zero independently.
