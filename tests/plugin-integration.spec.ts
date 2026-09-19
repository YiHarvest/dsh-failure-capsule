import { readdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import * as FailureCapsule from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Cordis plugin integration', () => {
  it('reads both current and legacy Session history contracts', () => {
    const events = [{ type: 'legacy' }]
    expect(FailureCapsule.snapshotSessionEvents({ events } as never)).toEqual(events)
    expect(FailureCapsule.snapshotSessionEvents({ snapshotEvents: () => events } as never)).toBe(events)
    expect(() => FailureCapsule.snapshotSessionEvents({} as never)).toThrow(/no supported history reader/)
  })

  it('retains a bounded event window and drains the ZIP write on unload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'failure-capsule-plugin-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(FailureCapsule, {
      outputDir: 'capsules',
      maxEvents: 2,
      captureGit: false,
      capturePlugins: true,
    })
    const session = ctx.sessions.create(SessionId('integration'), { meta: { cwd: root } })
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-1',
      name: 'bash',
      arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: {
        id: 'result-1',
        role: 'user',
        source: { kind: 'tool', tool: 'bash' },
        content: [{
          type: 'tool-result',
          toolCallId: 'call-1',
          isError: true,
          content: [{ type: 'text', text: 'integration failure' }],
        }],
      },
      error: { name: 'IntegrationError', code: 'TEST_FAILURE' },
    } as never, { surfaceOp: 'append' })

    await fiber.dispose()
    const files = await readdir(join(root, 'capsules'))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/integration_tool-error_event-2\.zip$/)

    const archive = unzipSync(await readFile(join(root, 'capsules', files[0]!)))
    const timeline = strFromU8(archive['timeline.jsonl']!).trim().split('\n').map(line => JSON.parse(line))
    const manifest = JSON.parse(strFromU8(archive['manifest.json']!))
    expect(timeline.map(event => event.seq)).toEqual([1, 2])
    expect(manifest.session).toMatchObject({ eventCount: 3, capturedEventCount: 2 })

    session.append('tool/result', {
      turn: 1,
      step: 2,
      message: {
        id: 'result-2',
        role: 'user',
        source: { kind: 'tool', tool: 'bash' },
        content: [{
          type: 'tool-result',
          toolCallId: 'call-2',
          isError: true,
          content: [{ type: 'text', text: 'failure after unload' }],
        }],
      },
      error: { name: 'IntegrationError', code: 'AFTER_UNLOAD' },
    } as never, { surfaceOp: 'append' })
    expect(await readdir(join(root, 'capsules'))).toHaveLength(1)
  })
})
