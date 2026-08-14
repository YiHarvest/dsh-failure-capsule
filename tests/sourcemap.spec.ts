import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCapsuleArchive } from '../src/capsule.ts'
import { resolveConfig } from '../src/config.ts'
import { parseStackFrames, renderStackTrace, resolveStack } from '../src/sourcemap.ts'
import type { CapsuleRequest } from '../src/types.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A valid source map that maps generated (1,0) to `src/original.ts` (3,2). */
const SOURCE_MAP = JSON.stringify({
  version: 3,
  file: 'bundle.js',
  sources: ['src/original.ts'],
  sourcesContent: ['L1\nL2\nL3 boom()\nL4\nL5\nL6\nL7\nL8\nL9'],
  names: ['boom'],
  mappings: 'AAEEA',
})

async function sourcemapFixture(): Promise<{ root: string; stack: string }> {
  const root = await mkdtemp(join(tmpdir(), 'failure-capsule-sourcemap-'))
  roots.push(root)
  await writeFile(join(root, 'bundle.js'), '(()=>{throw new Error("boom")})();\n')
  await writeFile(join(root, 'bundle.js.map'), SOURCE_MAP)
  const stack = [
    'Error: boom',
    `    at boom (${join(root, 'bundle.js')}:1:1)`,
    '    at Object.<anonymous> (node:internal/modules/cjs/loader:1256:14)',
  ].join('\n')
  return { root, stack }
}

describe('parseStackFrames', () => {
  it('parses a V8 stack into structured frames', () => {
    const frames = parseStackFrames([
      'Error: boom',
      '    at boom (/tmp/x/bundle.js:1:1)',
      '    at caller (/tmp/x/bundle.js:7:12)',
    ].join('\n'))
    expect(frames).toEqual([
      {
        fileName: '/tmp/x/bundle.js',
        lineNumber: 1,
        columnNumber: 1,
        functionName: 'boom',
        source: '    at boom (/tmp/x/bundle.js:1:1)',
      },
      {
        fileName: '/tmp/x/bundle.js',
        lineNumber: 7,
        columnNumber: 12,
        functionName: 'caller',
        source: '    at caller (/tmp/x/bundle.js:7:12)',
      },
    ])
  })

  it('returns an empty list for empty or unparseable input', () => {
    expect(parseStackFrames('')).toEqual([])
    expect(parseStackFrames('just some text without a stack')).toEqual([])
  })
})

describe('resolveStack', () => {
  it('maps a minified frame to original source with a context preview', async () => {
    const { root, stack } = await sourcemapFixture()
    const result = await resolveStack(stack, { root })

    expect(result.summary).toEqual({ frames: 2, mapped: 1, sourceMaps: 1 })
    expect(result.resolved[0]?.original).toMatchObject({
      source: join(root, 'src/original.ts'),
      line: 3,
      column: 2,
      name: 'boom',
    })
    expect(result.resolved[0]?.original?.context).toContainEqual({ line: 3, text: 'L3 boom()' })
    expect(result.resolved[0]?.sourceMapPath).toBe(join(root, 'bundle.js.map'))

    expect(result.resolved[1]?.original).toBeNull()
    expect(result.resolved[1]?.error).toBe('non-local or virtual frame')
  })

  it('does not map frames whose source map exceeds the byte budget', async () => {
    const { root, stack } = await sourcemapFixture()
    const result = await resolveStack(stack, { root, maxBytes: 128 })
    expect(result.summary).toMatchObject({ frames: 2, mapped: 0, sourceMaps: 0 })
    expect(result.resolved[0]?.original).toBeNull()
    expect(result.resolved[0]?.error).toBe('source map not found')
  })
})

describe('renderStackTrace', () => {
  it('renders a deterministic markdown document with context markers', async () => {
    const { root, stack } = await sourcemapFixture()
    const result = await resolveStack(stack, { root })
    const markdown = renderStackTrace(result)

    expect(markdown).toContain('# Failure Stack Trace')
    expect(markdown).toContain('src/original.ts:3:2')
    expect(markdown).toContain('>    3 | L3 boom()')
    expect(markdown).toContain('_non-local or virtual frame_')
    expect(markdown).toBe(renderStackTrace(result))
  })
})

describe('capsule integration', () => {
  it('resolves a failure stack into redacted stack-trace evidence', async () => {
    const { root, stack } = await sourcemapFixture()
    await writeFile(join(root, 'bundle.js.map'), SOURCE_MAP.replace('L3 boom()', 'L3 boom() // token=sk_abcdefghijklmnopqrstuvwxyz'))

    const request: CapsuleRequest = {
      session: {
        id: 'session',
        cwd: root,
        header: { version: 0, id: 'session', createdAt: 1_700_000_000_000, cwd: root },
        events: [],
      },
      trigger: {
        kind: 'agent-error',
        sessionId: 'session',
        time: 1_700_000_000_000,
        summary: 'boom',
        turn: 1,
        step: 1,
        error: { name: 'Error', code: 'UNKNOWN', message: 'boom', stack },
      },
      config: resolveConfig({ captureGit: false, capturePlugins: false }),
    }

    const archive = await buildCapsuleArchive(request)
    const files = unzipSync(archive.bytes)
    const names = Object.keys(files).sort()

    expect(names).toContain('stack-trace.json')
    expect(names).toContain('stack-trace.md')
    expect(archive.manifest.evidence.stackTrace).toBe(true)

    const allText = Object.values(files).map(value => strFromU8(value)).join('\n')
    expect(allText).not.toContain('sk_abcdefghijklmnopqrstuvwxyz')
    expect(allText).toContain('<redacted:token>')
    expect(allText).not.toContain(root)
    expect(allText).toContain('src/original.ts:3:2')
  })
})
