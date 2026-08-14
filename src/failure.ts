import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Config, FailureTrigger, ResolvedConfig } from './types.ts'
import { resolveConfig } from './config.ts'

function shortened(value: string, maximum = 500): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum)}…`
}

function toolResultText(event: SessionEvent<'tool/result'>): string {
  const content = event.data.message.content[0].content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('\n')
  return shortened(content.length === 0 ? 'Tool returned an error result.' : content)
}

/** Convert one durable session event into a failure trigger when configured. */
export function classifySessionFailure(
  sessionId: string,
  event: SessionEvent,
  inputConfig: ResolvedConfig | Config = resolveConfig(),
): FailureTrigger | undefined {
  const config = resolveConfig(inputConfig)
  if (event.type === 'tool/result') {
    const block = event.data.message.content[0]
    if (!config.triggerOnToolError || block.isError !== true) return undefined
    const identity = event.data.error
    return {
      kind: 'tool-error',
      sessionId,
      time: event.time,
      summary: toolResultText(event),
      turn: event.data.turn,
      step: event.data.step,
      eventSeq: event.seq,
      ...(identity === undefined ? {} : {
        error: {
          name: identity.name,
          code: identity.code,
          message: toolResultText(event),
        },
      }),
    }
  }

  if (event.type !== 'turn/end') return undefined
  const base = {
    sessionId,
    time: event.time,
    turn: event.data.turn,
    eventSeq: event.seq,
  }
  switch (event.data.reason.kind) {
    case 'error':
      if (!config.triggerOnTurnFailure) return undefined
      return {
        ...base,
        kind: 'turn-error',
        summary: shortened(event.data.reason.error.message),
        error: {
          name: 'LlmError',
          code: event.data.reason.error.code,
          message: shortened(event.data.reason.error.message),
        },
      }
    case 'blocked':
      return config.triggerOnTurnFailure
        ? { ...base, kind: 'turn-blocked', summary: 'The agent turn ended blocked.' }
        : undefined
    case 'interrupted':
      return config.triggerOnTurnFailure
        ? { ...base, kind: 'turn-interrupted', summary: 'A prior process ended before the turn could close.' }
        : undefined
    case 'aborted':
      return config.triggerOnAborted
        ? { ...base, kind: 'turn-aborted', summary: `The agent turn was aborted (${event.data.reason.reason.kind}).` }
        : undefined
    default:
      return undefined
  }
}

/** Flatten an arbitrary live agent error into bounded serializable facts. */
export function agentErrorTrigger(
  sessionId: string,
  turn: number,
  step: number,
  error: unknown,
  time = Date.now(),
): FailureTrigger {
  const name = error instanceof Error ? error.name : 'UnknownError'
  const message = shortened(error instanceof Error ? error.message : String(error))
  const code = typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'
  return {
    kind: 'agent-error',
    sessionId,
    time,
    summary: message,
    turn,
    step,
    error: { name, code, message },
  }
}
