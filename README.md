# Integration Agent

Pass an OpenAPI spec URL. Get a deployed MCP server in minutes.

**Production:** https://api-integration-agent-el-frompos-projects.vercel.app

---

Integration Agent is a production AI pipeline that converts any OpenAPI spec into a live [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server — automatically discovered, synthesised, validated, security-audited, and deployed to Vercel. Platform teams use it to connect any API to any AI agent without writing boilerplate.

---

## Pipeline

| # | Stage | What happens | Key file |
|---|-------|-------------|----------|
| 1 | **Discovery** | Parses the OpenAPI spec, extracts endpoints, parameters, auth, and schemas. If the spec has >50 endpoints or vague summaries, an optional Haiku call enriches and filters it. | `lib/pipeline/discover.ts` |
| 2 | **Synthesis** | Claude Haiku generates MCP tool definitions optimised for LLM consumption. Structured output via `Output.object()` + Zod schema. Retries up to 3 times with error context. | `lib/pipeline/synthesise.ts` |
| 3 | **Validation** | Generated TypeScript is written into a Vercel Sandbox (Firecracker VM), built with npm, started, and verified via live MCP `listTools()` calls. If the build fails, errors are fed back to synthesis for a second attempt. | `lib/pipeline/sandbox-check.ts` |
| 4 | **Security Audit** | 7 deterministic checks (SSRF, path traversal, hallucinated endpoints, missing auth on writes) run first. Then Claude Sonnet with extended thinking runs 3 AI-assisted checks (parameter injection, sensitive data exposure, destructive operations). Any `fail` finding blocks deployment. | `lib/pipeline/security-audit.ts` |
| 5 | **Deploy** | Generated files are pushed to a GitHub monorepo via the Git Trees API. A PR is opened, the workflow suspends until merge (webhook or polling), then a Vercel project is created and the deployment is polled until live. | `lib/pipeline/deploy/` |

The pipeline is a [Workflow DevKit](https://vercel.com/docs/workflow) durable workflow — it survives crashes and restarts, pauses for user approval at two points (tool review before build, audit review before deploy), and resumes from the exact step that was interrupted.

---

## Tech stack

**Framework**
- Next.js 16 (App Router, Turbopack, Fluid Compute)
- Tailwind CSS v4, shadcn/ui, Geist

**AI**
- [Vercel AI SDK v6](https://sdk.vercel.ai) — `generateText`, `streamText`, `Output.object()`, tool calling
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) — OIDC auth, cost attribution, provider failover
- Claude Haiku 4.5 — discovery enrichment + synthesis (mechanical, low-cost)
- Claude Sonnet 4.6 — security audit (reasoning) + validation chat (tool calling)

**Durable execution**
- [Workflow DevKit](https://vercel.com/docs/workflow) — `'use workflow'`, `'use step'`, `createHook()`, `createWebhook()`

**Sandbox**
- [Vercel Sandbox](https://vercel.com/docs/sandbox) — on-demand Firecracker VMs for isolated code validation

**Storage**
- [Neon Postgres](https://neon.tech) — integration records, encrypted credentials
- [Upstash Redis](https://upstash.com) — 30-day config/discovery cache, distributed locks, rate limiting

**Deploy automation**
- [Vercel SDK](https://github.com/vercel/sdk) — programmatic project creation, env var management, deployment polling
- [Octokit](https://github.com/octokit/rest.js) — PR creation, Git Trees API, webhook lifecycle

**Security**
- AES-256-GCM credential encryption (`lib/crypto.ts`)
- HMAC-SHA256 credential verification for deployed servers
- SSRF protection — DNS lookup + private IP range blocking before any outbound fetch
- Injection guards — Zod `.refine()` on all httpPaths (rejects backticks, `${`, `..`, null bytes)
- Fail-closed rate limiting — denies requests if Redis is unavailable

---

## Local setup

```bash
git clone https://github.com/fr0mpy/integration-agent
cd integration-agent
npm install
cp .env.local.example .env.local
# fill in required env vars (see table below)
npm run dev
```

The app runs at `http://localhost:3000`.

> **Note:** Full pipeline execution requires all env vars. The UI and discovery stage will work without `VERCEL_TOKEN` or `GITHUB_TOKEN`, but deployment will fail.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic key — routes through AI Gateway |
| `AI_GATEWAY_URL` | Yes | AI Gateway base URL. Default: `https://ai-gateway.vercel.sh/v1` |
| `VERCEL_TOKEN` | Yes | Vercel REST API token for programmatic project + deployment management |
| `VERCEL_TEAM_ID` | Yes | Team scope for all created Vercel projects |
| `DATABASE_URL` | Yes | Neon Postgres connection string |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST token |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key for credential encryption (32-byte hex string) |
| `CREDENTIAL_HMAC_SECRET` | Yes | Shared secret — deployed MCP servers use this to verify credential requests back to this app |
| `NEXT_PUBLIC_APP_URL` | Yes | Base URL of this app. Used as `CREDENTIAL_ENDPOINT` injected into deployed servers. Set to `http://localhost:3000` locally. |
| `OPENAI_API_KEY` | No | Optional AI Gateway fallback provider |

**Runtime credentials** (entered by users in the pipeline UI, not build-time):
- `GITHUB_TOKEN` — required to create the deployment monorepo and open PRs
- Per-API credentials (e.g., API keys for the target API) — stored encrypted in Neon

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm test` | Vitest unit tests — 94 tests across 9 files (all external deps mocked) |
| `npm run eval` | Synthesis eval CLI — real LLM calls against frozen fixtures, scored on 6 rubric dimensions |
| `npm run lint` | ESLint |

---

## Project structure

```
app/                        Next.js routes
├── page.tsx                Landing page — spec input + recent integrations
├── integrate/[id]/         Pipeline view — SSE-driven stage UI
└── api/
    ├── pipeline/[id]/      Trigger + SSE stream for pipeline execution
    ├── integrate/[id]/     Per-integration actions (build trigger, audit, credentials, files, sandbox)
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
│   ├── run.ts              CLI runner
│   ├── fixtures.ts         Frozen test inputs (Tasks CRUD, Weather readonly)
│   └── rubric.ts           6 deterministic scoring functions
├── crypto.ts               AES-256-GCM encryption
├── validation.ts           UUID + SSRF + IP range validation
└── config.ts               Model names, SSE config, env keys

components/
├── pipeline/               Stage-specific UI panels
├── SpecInput.tsx           Spec URL submission
└── ui/                     shadcn/ui base components

generated-server-template/  Template files for codegen output (bundled at build time)
hooks/use-pipeline.ts       SSE client with lastIndex reconnect + DB fallback polling
```

---

## Generated MCP servers

Each successful pipeline produces a minimal Next.js app deployed to its own Vercel project:

```
app/[transport]/route.ts    MCP handler (uses mcp-handler, supports SSE + streamable-http)
package.json                Minimal deps: next, mcp-handler, zod
next.config.ts              Minimal config
vercel.json                 fluid: true, 300s max duration
```

Tools are generated from the OpenAPI spec. On each request, the server fetches credentials via an HMAC-verified call back to this app — credentials are never stored in the deployed server itself.

Each server is an independent Vercel project scoped to a `mcps/{integrationId}/` subdirectory of the deployment monorepo. Scales to zero independently.

---

## Testing

```bash
npm test        # unit tests — mocked AI, DNS, Redis, Sandbox
npm run eval    # synthesis eval — real LLM calls via AI Gateway
```

**Unit tests (94):** cover encryption, validation, spec parsing, AI synthesis, sandbox checks, code generation, and Redis caching. All external dependencies are mocked — tests are fast and deterministic.

**Synthesis eval:** runs the synthesis stage against two frozen `DiscoveryResult` fixtures (a CRUD API with bearer auth, a read-only API with API key auth) and scores the output on six deterministic dimensions:

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

## CI/CD

GitHub Actions (`.github/workflows/deploy.yml`):

- **On PR:** lint → test → preview deploy → URL commented on PR
- **On push to main:** lint → test → production deploy

Build uses `vercel build` + `vercel deploy --prebuilt` (separate build and deploy steps for reproducibility).

Required GitHub Actions secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

---

## Security

- **SSRF:** DNS resolution before any outbound fetch; private IP ranges (`127.x`, `10.x`, `192.168.x`, `169.254.x`) blocked
- **Credentials:** AES-256-GCM encrypted at rest (random IV, auth tag for tamper detection); retrieved only via HMAC-verified requests from deployed servers using `timingSafeEqual`
- **Injection guards:** httpPath Zod refinement rejects backticks, `${`, `..`, null bytes, CRLF sequences
- **Rate limiting:** Upstash sliding window (10 req/min/IP), fail-closed — denies if Redis is unavailable
- **Headers:** CSP, HSTS, X-Frame-Options, X-Content-Type-Options set in `next.config.ts`
- **Distributed lock:** Redis lock prevents concurrent synthesis for the same spec

---

## Deployment

Deployed to Vercel on Fluid Compute — the pipeline spends most of its time waiting (AI responses, npm install in Sandbox, PR merge, deployment build). Fluid Compute charges for active CPU time rather than wall-clock time, making it well-suited for this workload.

Per-route `maxDuration` in `vercel.json`:
- Pipeline: 300s (full 5-stage workflow)
- Synthesis: 60s (standalone synthesis endpoint)
- Chat: 120s (streaming chat with tool calling)
