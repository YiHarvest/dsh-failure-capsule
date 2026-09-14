import { readdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
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

  it('observes a real SessionStore event and drains the ZIP write on unload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'failure-capsule-plugin-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(FailureCapsule, {
      outputDir: 'capsules',
      captureGit: false,
      capturePlugins: true,
    })
    const session = ctx.sessions.create(SessionId('integration'), { meta: { cwd: root } })
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
    expect(files[0]).toMatch(/integration_tool-error_event-0\.zip$/)
  })
})
