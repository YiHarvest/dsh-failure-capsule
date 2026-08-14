/**
 * Local-first source map resolution for failure stack traces.
 *
 * Resolves minified JavaScript frames back to their original source using
 * `@jridgewell/trace-mapping`, the synchronous, pure-JS decoder used by Vite
 * and Rollup. Lookup is strictly local: sibling `.map` files and inline
 * `sourceMappingURL` comments are read from disk under a bounded byte budget,
 * so no network access is involved.
 */

import { open, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseErrorStack } from 'error-stack-parser-es'
import {
  GREATEST_LOWER_BOUND,
  TraceMap,
  originalPositionFor,
  sourceContentFor,
} from '@jridgewell/trace-mapping'
import type { SourceMapInput } from '@jridgewell/trace-mapping'

/** Default budget for a single source map file (4 MiB). */
export const DEFAULT_MAX_SOURCE_MAP_BYTES = 4 * 1024 * 1024

/** Default number of source lines rendered before and after a mapped line. */
export const DEFAULT_CONTEXT_PADDING = 4

/** Bytes read from the tail of a script when looking for a `sourceMappingURL` comment. */
const SOURCE_MAPPING_URL_TAIL_BYTES = 32 * 1024

const SOURCE_MAPPING_URL = /\/\/[#@]\s*sourceMappingURL=(\S+)/

/** One parsed call-site from a JavaScript stack trace. */
export interface StackFrame {
  fileName: string | null
  lineNumber: number | null
  columnNumber: number | null
  functionName: string | null
  source: string | null
}

/** One source line and its 1-based number, used for context previews. */
export interface SourceLine {
  line: number
  text: string
}

/** Original-source resolution for one generated frame. */
export interface ResolvedFrame {
  frame: StackFrame
  /** `null` when no source map could map this frame. */
  original: {
    source: string
    line: number
    column: number
    name: string | null
    context: SourceLine[]
  } | null
  sourceMapPath: string | null
  error: string | null
}

/** Complete resolution of one raw stack string. */
export interface ResolvedStack {
  frames: StackFrame[]
  resolved: ResolvedFrame[]
  summary: {
    frames: number
    mapped: number
    sourceMaps: number
  }
}

/** Options anchoring source-map lookup to a working directory. */
export interface SourceMapOptions {
  /** Working directory used to anchor relative frame paths. */
  root: string
  /** Maximum bytes read from a single source map file. */
  maxBytes?: number
  /** Source lines rendered before and after a mapped line. */
  padding?: number
}

/** Cached per-path result: `null` caches a negative lookup. */
type SourceMapCache = Map<string, LoadedMap | null>

interface LoadedMap {
  map: TraceMap
  path: string
}

/** Parse a raw V8 / Firefox / Safari stack string into structured frames. */
export function parseStackFrames(stack: string): StackFrame[] {
  if (typeof stack !== 'string' || stack.trim().length === 0) return []
  try {
    return parseErrorStack({ stack } as Error, { allowEmpty: true })
      .map(frame => ({
        fileName: frame.fileName ?? null,
        lineNumber: frame.lineNumber ?? null,
        columnNumber: frame.columnNumber ?? null,
        functionName: frame.functionName ?? null,
        source: frame.source ?? null,
      }))
      .filter(frame => frame.fileName !== null || frame.lineNumber !== null || frame.columnNumber !== null)
  } catch {
    return []
  }
}

/** Resolve a raw stack string against local source maps in one working directory. */
export async function resolveStack(stack: string, options: SourceMapOptions): Promise<ResolvedStack> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SOURCE_MAP_BYTES
  const padding = options.padding ?? DEFAULT_CONTEXT_PADDING
  const frames = parseStackFrames(stack)
  const cache: SourceMapCache = new Map()
  const sourceMaps = new Set<string>()
  const resolved: ResolvedFrame[] = []
  for (const frame of frames) {
    resolved.push(await resolveFrame(frame, options.root, maxBytes, padding, cache, sourceMaps))
  }
  return {
    frames,
    resolved,
    summary: {
      frames: frames.length,
      mapped: resolved.filter(entry => entry.original !== null).length,
      sourceMaps: sourceMaps.size,
    },
  }
}

/** Render a resolved stack as a deterministic, human-readable Markdown document. */
export function renderStackTrace(resolved: ResolvedStack): string {
  const lines: string[] = [
    '# Failure Stack Trace',
    '',
    `- Frames: \`${resolved.summary.frames}\``,
    `- Mapped: \`${resolved.summary.mapped}\``,
    `- Source maps: \`${resolved.summary.sourceMaps}\``,
    '',
  ]
  resolved.resolved.forEach((entry, index) => {
    const frame = entry.frame
    const location = `${frame.fileName ?? '<anonymous>'}:${frame.lineNumber ?? '?'}:${frame.columnNumber ?? '?'}`
    lines.push(`## ${index + 1}. ${frame.functionName ?? '<anonymous>'} — \`${location}\``)
    if (entry.original === null) {
      lines.push('', entry.error === null ? '_Not mapped._' : `_${entry.error}_`, '')
      return
    }
    const original = entry.original
    lines.push('', `Mapped to \`${original.source}:${original.line}:${original.column}\``)
    if (original.name !== null) lines.push('', `Function: \`${original.name}\``)
    if (original.context.length > 0) {
      lines.push('', '```')
      for (const sourceLine of original.context) {
        const marker = sourceLine.line === original.line ? '>' : ' '
        lines.push(`${marker} ${String(sourceLine.line).padStart(4, ' ')} | ${sourceLine.text}`)
      }
      lines.push('```')
    }
    lines.push('')
  })
  return lines.join('\n')
}

async function resolveFrame(
  frame: StackFrame,
  root: string,
  maxBytes: number,
  padding: number,
  cache: SourceMapCache,
  sourceMaps: Set<string>,
): Promise<ResolvedFrame> {
  if (frame.lineNumber === null || frame.columnNumber === null) {
    return { frame, original: null, sourceMapPath: null, error: 'missing generated line or column' }
  }
  const scriptPath = framePath(frame.fileName, root)
  if (scriptPath === null) {
    return { frame, original: null, sourceMapPath: null, error: 'non-local or virtual frame' }
  }
  const loaded = await loadSourceMap(scriptPath, maxBytes, cache)
  if (loaded === null) {
    return { frame, original: null, sourceMapPath: null, error: 'source map not found' }
  }
  sourceMaps.add(loaded.path)

  const original = originalPositionFor(loaded.map, {
    // `originalPositionFor` takes a 1-based line but a 0-based column, while V8
    // stack traces (and therefore `error-stack-parser-es`) report a 1-based column.
    line: frame.lineNumber,
    column: frame.columnNumber - 1,
    bias: GREATEST_LOWER_BOUND,
  })
  if (original.source === null || original.line === null || original.column === null) {
    return { frame, original: null, sourceMapPath: loaded.path, error: 'generated position not mapped' }
  }

  let content = sourceContentFor(loaded.map, original.source)
  if (content === null) {
    content = await readSourceFallback(original.source, maxBytes)
  }
  return {
    frame,
    original: {
      source: original.source,
      line: original.line,
      column: original.column,
      name: original.name,
      context: content === null ? [] : contextLines(content, original.line, padding),
    },
    sourceMapPath: loaded.path,
    error: null,
  }
}

/** Convert a frame file reference into an absolute local path, or `null` when virtual. */
function framePath(fileName: string | null, root: string): string | null {
  if (fileName === null || fileName.length === 0) return null
  const cleaned = fileName.replace(/[?#].*$/, '')
  if (cleaned.length === 0) return null
  if (cleaned.startsWith('file://')) {
    try {
      return fileURLToPath(cleaned)
    } catch {
      return null
    }
  }
  if (cleaned.startsWith('node:') || cleaned.startsWith('webpack://') || cleaned.startsWith('<')) {
    return null
  }
  return isAbsolute(cleaned) ? cleaned : resolve(root, cleaned)
}

async function loadSourceMap(
  scriptPath: string,
  maxBytes: number,
  cache: SourceMapCache,
): Promise<LoadedMap | null> {
  const sibling = await readMap(`${scriptPath}.map`, maxBytes, cache)
  if (sibling !== null) return sibling

  const comment = await sourceMappingUrl(scriptPath)
  if (comment === null) return null
  if (comment.startsWith('data:')) {
    const parsed = decodeDataUri(comment)
    if (parsed === null) return null
    try {
      return { map: new TraceMap(parsed as SourceMapInput), path: scriptPath }
    } catch {
      return null
    }
  }
  return readMap(resolve(dirname(scriptPath), comment), maxBytes, cache)
}

async function readMap(
  mapPath: string,
  maxBytes: number,
  cache: SourceMapCache,
): Promise<LoadedMap | null> {
  const cached = cache.get(mapPath)
  if (cached !== undefined) return cached
  const loaded = await readMapFile(mapPath, maxBytes)
  cache.set(mapPath, loaded)
  return loaded
}

async function readMapFile(mapPath: string, maxBytes: number): Promise<LoadedMap | null> {
  try {
    const info = await stat(mapPath)
    if (!info.isFile() || info.size > maxBytes) return null
    const parsed = JSON.parse(await readFile(mapPath, 'utf8')) as SourceMapInput
    return { map: new TraceMap(parsed, mapPath), path: mapPath }
  } catch {
    return null
  }
}

async function sourceMappingUrl(scriptPath: string): Promise<string | null> {
  try {
    const handle = await open(scriptPath, 'r')
    try {
      const info = await handle.stat()
      const length = Math.min(info.size, SOURCE_MAPPING_URL_TAIL_BYTES)
      if (length <= 0) return null
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, info.size - length)
      const match = SOURCE_MAPPING_URL.exec(buffer.toString('utf8'))
      return match?.[1] ?? null
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

function decodeDataUri(uri: string): unknown {
  const comma = uri.indexOf(',')
  if (comma < 0) return null
  const meta = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)
  try {
    if (meta.includes(';base64')) {
      return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    }
    return JSON.parse(decodeURIComponent(payload))
  } catch {
    return null
  }
}

async function readSourceFallback(sourcePath: string, maxBytes: number): Promise<string | null> {
  try {
    const info = await stat(sourcePath)
    if (!info.isFile() || info.size > maxBytes) return null
    return readFile(sourcePath, 'utf8')
  } catch {
    return null
  }
}

function contextLines(content: string, line: number, padding: number): SourceLine[] {
  const lines = content.split('\n')
  const start = Math.max(0, line - 1 - padding)
  const end = Math.min(lines.length, line + padding)
  const result: SourceLine[] = []
  for (let index = start; index < end; index += 1) {
    result.push({ line: index + 1, text: lines[index] ?? '' })
  }
  return result
}
