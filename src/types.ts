import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Failure classes that can produce a capsule. */
export type FailureKind =
  | 'tool-error'
  | 'turn-error'
  | 'turn-blocked'
  | 'turn-interrupted'
  | 'turn-aborted'
  | 'agent-error'

/** Serializable identity and explanation for one detected failure. */
export interface FailureTrigger {
  kind: FailureKind
  sessionId: string
  time: number
  summary: string
  turn?: number
  step?: number
  eventSeq?: number
  error?: {
    name: string
    code: string
    message: string
    /** Raw `Error.stack` captured when the failure carried one. */
    stack?: string
  }
}

/** User-facing plugin configuration accepted by Cordis. */
export interface Config {
  /** Relative paths resolve from the session working directory. */
  outputDir?: string
  /** Maximum session events retained before and including a failure. */
  maxEvents?: number
  /** Maximum bytes captured from each Git command. */
  maxGitBytes?: number
  /** Include Git state and diffs when the session cwd is a repository. */
  captureGit?: boolean
  /** Include the current Cordis Loader entry inventory. */
  capturePlugins?: boolean
  /** Generate a capsule for every failed tool result. */
  triggerOnToolError?: boolean
  /** Generate a capsule for error, blocked, and interrupted turn endings. */
  triggerOnTurnFailure?: boolean
  /** Treat user or policy cancellation as a failure. */
  triggerOnAborted?: boolean
  /** Capture live agent errors that never receive a durable failed turn. */
  triggerOnAgentError?: boolean
  /** Resolve minified JS stack frames against local source maps. */
  resolveSourceMaps?: boolean
  /** Maximum bytes read from a single source map file. */
  maxSourceMapBytes?: number
}

/** Fully defaulted, validated plugin configuration. */
export interface ResolvedConfig {
  outputDir: string
  maxEvents: number
  maxGitBytes: number
  captureGit: boolean
  capturePlugins: boolean
  triggerOnToolError: boolean
  triggerOnTurnFailure: boolean
  triggerOnAborted: boolean
  triggerOnAgentError: boolean
  resolveSourceMaps: boolean
  maxSourceMapBytes: number
}

/** Stable projection of one Loader entry. */
export interface PluginInventoryEntry {
  entryId: string
  moduleName: string
  enabled: boolean
  phase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
}

/** Detached session data consumed by the archive builder. */
export interface CapsuleSession {
  id: string
  cwd?: string
  header: unknown
  events: readonly SessionEvent[]
}

/** Redaction counters safe to include beside an archive. */
export interface RedactionReport {
  total: number
  byRule: Record<string, number>
}

/** Machine-readable top-level index stored as manifest.json. */
export interface CapsuleManifest {
  schemaVersion: 1
  generator: {
    name: 'dsh-failure-capsule'
    version: string
  }
  createdAt: string
  trigger: FailureTrigger
  session: {
    id: string
    cwd?: string
    eventCount: number
    capturedEventCount: number
  }
  evidence: {
    git: boolean
    plugins: boolean
    stackTrace: boolean
  }
  redaction: RedactionReport
  files: string[]
}

/** Completed capsule written to disk. */
export interface CapsuleResult {
  path: string
  bytes: number
  manifest: CapsuleManifest
}

/** Inputs for a standalone capsule build. */
export interface CapsuleRequest {
  session: CapsuleSession
  trigger: FailureTrigger
  config: ResolvedConfig
  plugins?: readonly PluginInventoryEntry[]
}
