/**
 * DeepSeek Harness plugin that writes local, redacted failure evidence ZIPs.
 *
 * @module dsh-failure-capsule
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import { resolveConfig } from './config.ts'
import { agentErrorTrigger, classifySessionFailure } from './failure.ts'
import { writeFailureCapsule } from './capsule.ts'
import type {
  CapsuleRequest,
  Config as PluginConfig,
  FailureTrigger,
  PluginInventoryEntry,
  ResolvedConfig,
} from './types.ts'

export { buildCapsuleArchive, VERSION, writeFailureCapsule } from './capsule.ts'
export { DEFAULT_CONFIG, resolveConfig } from './config.ts'
export { collectGitEvidence, collectRuntimeEvidence, runBoundedCommand } from './evidence.ts'
export { agentErrorTrigger, classifySessionFailure } from './failure.ts'
export { Redactor } from './redaction.ts'
export {
  DEFAULT_CONTEXT_PADDING,
  DEFAULT_MAX_SOURCE_MAP_BYTES,
  parseStackFrames,
  renderStackTrace,
  resolveStack,
} from './sourcemap.ts'
export type { ResolvedFrame, ResolvedStack, SourceLine, SourceMapOptions, StackFrame } from './sourcemap.ts'
export type * from './types.ts'

/** Cordis plugin name shown in Loader diagnostics. */
export const name = 'failure-capsule'

/** Loader access supplies the active plugin inventory stored in each capsule. */
export const inject = ['loader']

/** Schemastery metadata and primitive validation for plugin configuration. */
export const Config: z<PluginConfig> = z.object({
  outputDir: z.string(),
  maxEvents: z.number(),
  maxGitBytes: z.number(),
  captureGit: z.boolean(),
  capturePlugins: z.boolean(),
  triggerOnToolError: z.boolean(),
  triggerOnTurnFailure: z.boolean(),
  triggerOnAborted: z.boolean(),
  triggerOnAgentError: z.boolean(),
  resolveSourceMaps: z.boolean(),
  maxSourceMapBytes: z.number(),
})

const PHASES = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
} as const

function inventory(ctx: Context): PluginInventoryEntry[] {
  const entries: PluginInventoryEntry[] = []
  for (const entry of ctx.loader.entries()) {
    if (entry.options.group) continue
    const state = entry.fiber?.state
    entries.push({
      entryId: String(entry.id),
      moduleName: entry.options.name,
      enabled: !entry.disabled,
      phase: state === undefined ? null : PHASES[state],
    })
  }
  return entries
}

function terminalFailure(event: SessionEvent): boolean {
  if (event.type !== 'turn/end') return false
  switch (event.data.reason.kind) {
    case 'error':
    case 'blocked':
    case 'interrupted':
    case 'aborted':
      return true
    default:
      return false
  }
}

class FailureCapsuleManager {
  private readonly pending = new Set<Promise<void>>()
  private readonly seen = new Set<string>()
  private readonly terminalTurns = new Set<string>()
  private readonly liveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  onSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type === 'turn/end' && terminalFailure(event)) {
      const key = this.turnKey(session.id, event.data.turn)
      this.terminalTurns.add(key)
      const timer = this.liveTimers.get(key)
      if (timer !== undefined) {
        clearTimeout(timer)
        this.liveTimers.delete(key)
      }
    }
    const trigger = classifySessionFailure(session.id, event, this.config)
    if (trigger !== undefined) this.capture(session, trigger)
  }

  onAgentError(agent: Agent, turn: number, step: number, error: unknown): void {
    if (!this.config.triggerOnAgentError || this.disposed) return
    const key = this.turnKey(agent.id, turn)
    if (this.terminalTurns.has(key) || this.liveTimers.has(key)) return

    const timer = setTimeout(() => {
      this.liveTimers.delete(key)
      if (this.disposed || this.terminalTurns.has(key)) return
      this.capture(agent.session, agentErrorTrigger(agent.id, turn, step, error))
    }, 25)
    timer.unref()
    this.liveTimers.set(key, timer)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const timer of this.liveTimers.values()) clearTimeout(timer)
    this.liveTimers.clear()
    await Promise.all(this.pending)
  }

  private capture(session: Session, trigger: FailureTrigger): void {
    const identity = trigger.eventSeq === undefined
      ? `${trigger.sessionId}:${trigger.kind}:${trigger.turn ?? '-'}:${trigger.step ?? '-'}`
      : `${trigger.sessionId}:${trigger.kind}:${trigger.eventSeq}`
    if (this.disposed || this.seen.has(identity)) return
    this.seen.add(identity)

    const request: CapsuleRequest = {
      session: {
        id: session.id,
        ...(session.header.cwd === undefined ? {} : { cwd: session.header.cwd }),
        header: structuredClone(session.header),
        events: [...session.events],
      },
      trigger,
      config: this.config,
      ...(this.config.capturePlugins ? { plugins: inventory(this.ctx) } : {}),
    }
    const task = writeFailureCapsule(request)
      .then(result => {
        this.ctx.logger.info('failure-capsule: wrote %s (%d bytes)', result.path, result.bytes)
      })
      .catch((error: unknown) => {
        this.ctx.logger.warn('failure-capsule: capture failed: %s', error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        this.pending.delete(task)
      })
    this.pending.add(task)
  }

  private turnKey(sessionId: string, turn: number): string {
    return `${sessionId}:${turn}`
  }
}

/** Subscribe to durable and live failure signals and own all archive tasks. */
export function apply(ctx: Context, config: PluginConfig = {}): void {
  const manager = new FailureCapsuleManager(ctx, resolveConfig(config))
  ctx.on('session/event', (session, event) => {
    manager.onSessionEvent(session, event)
  })
  ctx.on('agent/error', ({ agent, turn, step, error }) => {
    manager.onAgentError(agent, turn, step, error)
  })
  ctx.effect(() => () => manager.dispose(), 'failure-capsule drain')
}
