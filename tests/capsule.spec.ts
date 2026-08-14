import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import packageJson from '../package.json'
import { buildCapsuleArchive, VERSION, writeFailureCapsule } from '../src/capsule.ts'
import { resolveConfig } from '../src/config.ts'
import type { CapsuleRequest } from '../src/types.ts'

const exec = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; request: CapsuleRequest; secret: string }> {
  const root = await mkdtemp(join(tmpdir(), 'failure-capsule-archive-'))
  roots.push(root)
  const secret = 'sk_abcdefghijklmnopqrstuvwxyz123456'
  await exec('git', ['init', '-q'], { cwd: root })
  await writeFile(join(root, 'source.txt'), 'safe\n')
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
  await exec('git', ['add', 'source.txt', 'package.json'], { cwd: root })
  await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'initial'], { cwd: root })
  await writeFile(join(root, 'source.txt'), `token=${secret}\n`)

  const events = [
    { type: 'turn/start', seq: 0, time: 1_700_000_000_000, data: { turn: 1 } },
    {
      type: 'tool/call',
      seq: 1,
      time: 1_700_000_000_001,
      data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: `{"token":"${secret}"}` },
    },
    {
      type: 'tool/result',
      seq: 2,
      time: 1_700_000_000_002,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'm1',
          role: 'user',
          source: { kind: 'tool', tool: 'bash' },
          content: [{
            type: 'tool-result',
            toolCallId: 'c1',
            isError: true,
            content: [{ type: 'text', text: `failed with ${secret}` }],
          }],
        },
        error: { name: 'ShellError', code: 'EXIT_1' },
      },
    },
  ] as unknown as SessionEvent[]

  return {
    root,
    secret,
    request: {
      session: {
        id: '../../unsafe session',
        cwd: root,
        header: { version: 0, id: '../../unsafe session', createdAt: 1_700_000_000_000, cwd: root },
        events,
      },
      trigger: {
        kind: 'tool-error',
        sessionId: '../../unsafe session',
        time: 1_700_000_000_002,
        summary: `failed with ${secret}`,
        turn: 1,
        step: 1,
        eventSeq: 2,
        error: { name: 'ShellError', code: 'EXIT_1', message: `failed with ${secret}` },
      },
      config: resolveConfig({ outputDir: 'capsules', maxEvents: 2 }),
      plugins: [
        { entryId: 'z', moduleName: 'z-plugin', enabled: false, phase: null },
        { entryId: 'a', moduleName: 'a-plugin', enabled: true, phase: 'active' },
      ],
    },
  }
}

describe('capsule archive', () => {
  it('keeps the embedded version synchronized with package.json', () => {
    expect(VERSION).toBe(packageJson.version)
  })

  it('builds deterministic, bounded, redacted evidence with a machine-readable manifest', async () => {
    const { request, secret, root } = await fixture()
    const first = await buildCapsuleArchive(request)
    const second = await buildCapsuleArchive(request)
    expect(first.bytes).toEqual(second.bytes)

    const archive = unzipSync(first.bytes)
    const names = Object.keys(archive).sort()
    expect(names).toContain('manifest.json')
    expect(names).toContain('diagnosis.md')
    expect(names).toContain('git/working-tree.patch')
    expect(names).toContain('plugins.json')
    const allText = Object.values(archive).map(value => strFromU8(value)).join('\n')
    expect(allText).not.toContain(secret)
    expect(allText).not.toContain(root)
    expect(allText).toContain('<redacted:token>')
    expect(first.manifest.session.capturedEventCount).toBe(2)
    expect(first.manifest.redaction.total).toBeGreaterThan(0)
    expect(first.manifest.evidence).toEqual({ git: true, plugins: true })
  })

  it('writes atomically under a sanitized filename', async () => {
    const { request } = await fixture()
    const result = await writeFailureCapsule(request)
    expect(result.path).toMatch(/capsules\/.*unsafe-session_tool-error_event-2\.zip$/)
    expect((await readFile(result.path)).byteLength).toBe(result.bytes)
  })
})
