import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { agentErrorTrigger, classifySessionFailure } from '../src/failure.ts'

function event<T extends SessionEvent>(value: T): T {
  return value
}

describe('failure classification', () => {
  it('classifies failed tool results with structured identity', () => {
    const toolFailure = event({
      type: 'tool/result',
      seq: 4,
      time: 123,
      surfaceOp: 'append',
      data: {
        turn: 2,
        step: 1,
        message: {
          id: 'm1',
          role: 'user',
          source: { kind: 'tool', tool: 'bash' },
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            isError: true,
            content: [{ type: 'text', text: 'command failed' }],
          }],
        },
        error: { name: 'ShellError', code: 'EXIT_1' },
      },
    } as unknown as SessionEvent<'tool/result'>)

    expect(classifySessionFailure('s1', toolFailure, resolveConfig({}))).toMatchObject({
      kind: 'tool-error',
      eventSeq: 4,
      turn: 2,
      step: 1,
      error: { name: 'ShellError', code: 'EXIT_1' },
    })
  })

  it('captures terminal turn failures but ignores completion and default aborts', () => {
    const failed = event({
      type: 'turn/end',
      seq: 8,
      time: 456,
      data: { turn: 3, reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: 'slow down' } } },
    } as SessionEvent<'turn/end'>)
    const completed = event({
      type: 'turn/end', seq: 9, time: 457, data: { turn: 4, reason: { kind: 'completed' } },
    } as SessionEvent<'turn/end'>)
    const aborted = event({
      type: 'turn/end',
      seq: 10,
      time: 458,
      data: { turn: 5, reason: { kind: 'aborted', reason: { kind: 'user' } } },
    } as SessionEvent<'turn/end'>)

    expect(classifySessionFailure('s1', failed, resolveConfig({}))).toMatchObject({
      kind: 'turn-error',
      error: { code: 'RATE_LIMIT' },
    })
    expect(classifySessionFailure('s1', completed, resolveConfig({}))).toBeUndefined()
    expect(classifySessionFailure('s1', aborted, resolveConfig({}))).toBeUndefined()
    expect(classifySessionFailure('s1', aborted, resolveConfig({ triggerOnAborted: true })))
      .toMatchObject({ kind: 'turn-aborted' })
  })

  it('normalizes arbitrary live agent errors', () => {
    const failure = Object.assign(new Error('network down'), { code: 'ECONNRESET' })
    expect(agentErrorTrigger('s1', 2, 3, failure, 99)).toEqual({
      kind: 'agent-error',
      sessionId: 's1',
      time: 99,
      summary: 'network down',
      turn: 2,
      step: 3,
      error: { name: 'Error', code: 'ECONNRESET', message: 'network down' },
    })
  })
})
