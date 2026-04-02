'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { cn } from '@/lib/utils'

interface BundledFile {
  file: string
  data: string
}

const ROUTE_FILE = 'app/[transport]/route.ts'

interface CodeViewerProps {
  integrationId: string
  /**
   * Live sourceCode from the pipeline's validate:running event.
   * When provided this is used for the route.ts tab instead of re-fetching,
   * so the viewer always reflects the current run's codegen output.
   * In cached mode this is null and all files come from the API.
   */
  sourceCode?: string | null
  /** True while the sandbox is being built — defers the file fetch and shows skeleton */
  sandboxBuilding?: boolean
  /** Allow editing route.ts (only when validation is complete) */
  editable?: boolean
  /** Persist edited source to the server */
  onSave?: (source: string) => Promise<void>
  /** Revert to generated source */
  onReset?: () => Promise<void>
}

const FILE_ORDER = [
  ROUTE_FILE,
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

export function CodeViewer({ integrationId, sourceCode, sandboxBuilding, editable, onSave, onReset }: CodeViewerProps) {
  const [files, setFiles] = useState<BundledFile[]>([])
  const [activeFile, setActiveFile] = useState(FILE_ORDER[0])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editedSource, setEditedSource] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    // Stay in loading skeleton while the sandbox is still being built
    if (sandboxBuilding) return

    async function load() {
      setError(null)
      setLoading(true)

      try {
        const res = await fetch(`/api/integrate/${integrationId}/files`)
        if (!res.ok) throw new Error('Failed to load generated files')
        const { files: loaded } = await res.json() as { files: BundledFile[] }
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
  }, [integrationId, sandboxBuilding])

  // Clear local edits only when AI produces genuinely new code (not SSE replay)
  const prevSourceCode = useRef(sourceCode)
  useEffect(() => {
    if (sourceCode && sourceCode !== prevSourceCode.current) {
      setEditedSource(null)
    }

    prevSourceCode.current = sourceCode
  }, [sourceCode])

  // Auto-save edits after 1s of inactivity
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  useEffect(() => {
    if (editedSource === null || !onSaveRef.current) return
    const timer = setTimeout(() => {
      onSaveRef.current?.(editedSource)
    }, 1000)
    return () => clearTimeout(timer)
  }, [editedSource])

  // Override route.ts with live SSE data (only before /files loads) or local edits
  const displayFiles = useMemo(() => {
    let result = files

    if (sourceCode && files.length === 0) {
      result = [{ file: ROUTE_FILE, data: sourceCode }]
    }

    if (editedSource !== null) {
      result = result.map((f) =>
        f.file === ROUTE_FILE ? { ...f, data: editedSource } : f,
      )
    }

    return result
  }, [files, sourceCode, editedSource])

  const activeContent = displayFiles.find((f) => f.file === activeFile)?.data ?? ''
  const dirty = editedSource !== null
  const isRouteFile = activeFile === ROUTE_FILE
  const canEdit = editable && isRouteFile

  const handleChange = useCallback((value: string) => {
    setEditedSource(value)
  }, [])

  const handleSave = useCallback(async () => {
    if (!editedSource || !onSave) return
    setSaving(true)
    setSaveError(null)

    try {
      await onSave(editedSource)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editedSource, onSave])

  const handleReset = useCallback(async () => {
    if (!onReset) return
    setSaving(true)
    setSaveError(null)

    try {
      await onReset()
      setEditedSource(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setSaving(false)
    }
  }, [onReset])

  if (loading) {
    return (
      <div className="flex h-[520px] flex-col rounded-lg border border-border bg-zinc-950">
        <div className="flex gap-1 border-b border-border px-2 pt-2">
          {FILE_ORDER.map((f) => (
            <div key={f} className="h-7 w-20 animate-pulse rounded-t bg-zinc-800" />
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Initializing…
        </div>
      </div>
    )
  }

  if (error && displayFiles.length === 0) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-lg border border-red-500/25 bg-zinc-950 text-sm text-red-400">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-[520px] flex-col overflow-hidden rounded-lg border border-border bg-zinc-950">
      {/* File tabs + actions */}
      <div className="flex shrink-0 items-center border-b border-border bg-zinc-900 px-2 pt-1.5">
        <div className="flex flex-1 gap-0 overflow-x-auto scrollbar-none">
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
              {f.file === ROUTE_FILE && dirty && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          ))}
        </div>

        {/* Save / Reset buttons */}
        {editable && dirty && (
          <div className="flex shrink-0 items-center gap-1.5 pb-1">
            {saveError && (
              <span className="text-[10px] text-red-400">{saveError}</span>
            )}
            <button
              onClick={handleReset}
              disabled={saving}
              className="rounded px-2 py-1 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-zinc-700 px-2.5 py-1 text-[10px] font-medium text-zinc-200 hover:bg-zinc-600 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeMirror
          value={activeContent}
          theme={oneDark}
          extensions={getExtensions(activeFile)}
          editable={canEdit}
          onChange={canEdit ? handleChange : undefined}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: canEdit,
            highlightSelectionMatches: canEdit,
          }}
          height="100%"
          style={{ fontSize: '12px' }}
        />
      </div>
    </div>
  )
}
