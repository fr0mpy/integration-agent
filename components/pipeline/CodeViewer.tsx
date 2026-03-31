'use client'

import { useState, useEffect } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { cn } from '@/lib/utils'

interface BundledFile {
  file: string
  data: string
}

interface CodeViewerProps {
  integrationId: string
  /**
   * Live sourceCode from the pipeline's validate:running event.
   * When provided this is used for the route.ts tab instead of re-fetching,
   * so the viewer always reflects the current run's codegen output.
   * In cached mode this is null and all files come from the API.
   */
  sourceCode?: string | null
}

const FILE_ORDER = [
  'app/[transport]/route.ts',
  'package.json',
  'vercel.json',
  'next.config.ts',
  'tsconfig.json',
]

function shortName(file: string): string {
  const parts = file.split('/')
  return parts[parts.length - 1]
}

function getExtensions(file: string) {
  if (file.endsWith('.json')) return [json()]
  return [javascript({ typescript: true })]
}

export function CodeViewer({ integrationId, sourceCode }: CodeViewerProps) {
  const [files, setFiles] = useState<BundledFile[]>([])
  const [activeFile, setActiveFile] = useState(FILE_ORDER[0])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/integrate/${integrationId}/files`)
        if (!res.ok) throw new Error('Failed to load generated files')
        const { files: loaded } = await res.json() as { files: BundledFile[] }
        // Sort by canonical order
        const sorted = FILE_ORDER
          .map((name) => loaded.find((f) => f.file === name))
          .filter((f): f is BundledFile => f != null)
        setFiles(sorted)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [integrationId])

  // Override route.ts with the live codegen output when available.
  // This ensures we show the current run's source, not the stale Redis cache.
  const displayFiles = sourceCode
    ? files.map((f) =>
        f.file === 'app/[transport]/route.ts' ? { ...f, data: sourceCode } : f,
      )
    : files

  const activeContent = displayFiles.find((f) => f.file === activeFile)?.data ?? ''

  if (loading) {
    return (
      <div className="flex h-[520px] flex-col rounded-lg border border-border bg-zinc-950">
        <div className="flex gap-1 border-b border-border px-2 pt-2">
          {FILE_ORDER.map((f) => (
            <div key={f} className="h-7 w-20 animate-pulse rounded-t bg-zinc-800" />
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-lg border border-red-500/25 bg-zinc-950 text-sm text-red-400">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-[520px] flex-col overflow-hidden rounded-lg border border-border bg-zinc-950">
      {/* File tabs */}
      <div className="flex shrink-0 gap-0 overflow-x-auto border-b border-border bg-zinc-900 px-2 pt-1.5 scrollbar-none">
        {displayFiles.map((f) => (
          <button
            key={f.file}
            onClick={() => setActiveFile(f.file)}
            className={cn(
              'shrink-0 rounded-t px-3 py-1.5 font-mono text-xs transition-colors',
              activeFile === f.file
                ? 'bg-zinc-950 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {shortName(f.file)}
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeMirror
          value={activeContent}
          theme={oneDark}
          extensions={getExtensions(activeFile)}
          editable={false}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: false,
            highlightSelectionMatches: false,
          }}
          style={{ height: '100%', fontSize: '12px' }}
        />
      </div>
    </div>
  )
}
