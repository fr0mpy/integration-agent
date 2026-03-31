import { readFileSync } from 'fs'
import { join } from 'path'
import type { MCPServerConfig } from './types'
import { generateServerSource } from './template'

const TMPL_DIR = join(process.cwd(), 'generated-server-template')

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

  const packageJson = readFileSync(join(TMPL_DIR, 'package.json.tmpl'), 'utf-8')
  const vercelJson = readFileSync(join(TMPL_DIR, 'vercel.json.tmpl'), 'utf-8')
  const nextConfig = readFileSync(join(TMPL_DIR, 'next.config.ts.tmpl'), 'utf-8')

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

  const files: BundledFile[] = [
    { file: 'app/[transport]/route.ts', data: sourceCode },
    { file: 'package.json', data: packageJson },
    { file: 'vercel.json', data: vercelJson },
    { file: 'next.config.ts', data: nextConfig },
    { file: 'tsconfig.json', data: tsConfig },
  ]

  // Inject the base URL as a build-time env in the package.json
  const pkg = JSON.parse(packageJson) as { env?: Record<string, string> }
  pkg.env = { MCP_BASE_URL: config.baseUrl }
  files[1] = { file: 'package.json', data: JSON.stringify(pkg, null, 2) }

  return { files, sourceCode }
}
