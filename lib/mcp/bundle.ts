// Assembles the full deploy payload for a generated MCP server — templates cached at module load
import { readFileSync } from 'fs'
import { join } from 'path'
import type { MCPServerConfig } from './types'
import { generateServerSource } from './template'

const TMPL_DIR = join(process.cwd(), 'generated-server-template')

// Cache template reads at module load — bundleServer is called on every /files and /chat request
const PACKAGE_JSON_TMPL = readFileSync(join(TMPL_DIR, 'package.json.tmpl'), 'utf-8')
const VERCEL_JSON_TMPL = readFileSync(join(TMPL_DIR, 'vercel.json.tmpl'), 'utf-8')
const NEXT_CONFIG_TMPL = readFileSync(join(TMPL_DIR, 'next.config.ts.tmpl'), 'utf-8')

export interface BundledFile {
  /** Relative path inside the deploy (e.g. 'app/[transport]/route.ts') */
  file: string
  data: string
}

export interface BundleResult {
  files: BundledFile[]
  /** Generated route.ts source — emitted to the UI for the code viewer */
  sourceCode: string
}

/**
 * Assembles the full deploy payload for a generated MCP server.
 * Returns file descriptors for the Vercel SDK deployment and the raw
 * source code string for streaming to the pipeline UI.
 */
export function bundleServer(config: MCPServerConfig): BundleResult {
  const sourceCode = generateServerSource(config)

  const packageJson = PACKAGE_JSON_TMPL
  const vercelJson = VERCEL_JSON_TMPL
  // Embed MCP_BASE_URL into next.config.ts so it's available at build and runtime
  const nextConfig = NEXT_CONFIG_TMPL.replace(
    'const nextConfig: NextConfig = {}',
    `const nextConfig: NextConfig = { env: { MCP_BASE_URL: ${JSON.stringify(config.baseUrl)} } }`,
  )

  const tsConfig = JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2017',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [{ name: 'next' }],
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'],
      exclude: ['node_modules'],
    },
    null,
    2,
  )

  // File layout mirrors a minimal Next.js project — deployed as its own Vercel project
  const files: BundledFile[] = [
    { file: 'app/[transport]/route.ts', data: sourceCode },
    { file: 'app/layout.tsx', data: 'export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html><body>{children}</body></html>\n}\n' },
    { file: 'package.json', data: packageJson },
    { file: 'vercel.json', data: vercelJson },
    { file: 'next.config.ts', data: nextConfig },
    { file: 'tsconfig.json', data: tsConfig },
  ]

  return { files, sourceCode }
}
