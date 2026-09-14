import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { collectGitEvidence, collectRuntimeEvidence } from './evidence.ts'
import { Redactor } from './redaction.ts'
import { renderStackTrace, resolveStack } from './sourcemap.ts'
import type { ResolvedStack } from './sourcemap.ts'
import type {
  CapsuleManifest,
  CapsuleRequest,
  CapsuleResult,
  FailureTrigger,
  PluginInventoryEntry,
} from './types.ts'

/** Package version embedded in every archive. Kept in sync by a test. */
export const VERSION = '0.2.4'

const ZIP_TIME = new Date('1980-01-01T00:00:00.000Z')

interface CapsuleArchive {
  bytes: Uint8Array
  manifest: CapsuleManifest
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function eventWindow(request: CapsuleRequest): readonly unknown[] {
  const events = request.session.events
  const boundary = request.trigger.eventSeq === undefined
    ? events.length
    : Math.min(events.length, request.trigger.eventSeq + 1)
  return events.slice(Math.max(0, boundary - request.config.maxEvents), boundary)
}

function sortPlugins(plugins: readonly PluginInventoryEntry[] | undefined): readonly PluginInventoryEntry[] | undefined {
  return plugins === undefined
    ? undefined
    : [...plugins].sort((left, right) => left.entryId.localeCompare(right.entryId))
}

function diagnosis(trigger: FailureTrigger, hasGit: boolean, eventCount: number): string {
  const suggestions: string[] = []
  switch (trigger.kind) {
    case 'tool-error':
      suggestions.push('Inspect the matching `tool/call` and `tool/result` rows in `timeline.jsonl`.')
      suggestions.push('Re-run the exact tool arguments only after checking the workspace and permission state.')
      break
    case 'turn-error':
    case 'agent-error':
      suggestions.push('Start with the failure code and the last request header in `timeline.jsonl`.')
      suggestions.push('Check provider availability, request limits, cancellation, and retry policy.')
      break
    case 'turn-blocked':
      suggestions.push('Check approval, sandbox, and policy events immediately before the turn boundary.')
      break
    case 'turn-interrupted':
      suggestions.push('Check process shutdown logs and the last open step before resuming the session.')
      break
    case 'turn-aborted':
      suggestions.push('Confirm whether cancellation was user-initiated, parent-initiated, or policy-initiated.')
      break
  }
  if (hasGit) suggestions.push('Review `git/status.txt`, `git/working-tree.patch`, and `git/index.patch` together.')

  return [
    '# Failure Capsule Diagnosis',
    '',
    `- Failure: \`${trigger.kind}\``,
    `- Session: \`${trigger.sessionId}\``,
    ...(trigger.turn === undefined ? [] : [`- Turn: \`${trigger.turn}\``]),
    ...(trigger.step === undefined ? [] : [`- Step: \`${trigger.step}\``]),
    `- Captured timeline events: \`${eventCount}\``,
    '',
    '## Summary',
    '',
    trigger.summary,
    '',
    '## Suggested triage',
    '',
    ...suggestions.map((value, index) => `${index + 1}. ${value}`),
    '',
    '> This diagnosis is deterministic and model-free. It organizes evidence; it does not claim a root cause.',
    '',
  ].join('\n')
}

function safeFilename(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe.length === 0 ? 'session' : safe.slice(0, 80)
}

function encoded(files: Readonly<Record<string, string>>): Record<string, Uint8Array> {
  return Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, strToU8(contents)]))
}

/** Assemble a deterministic ZIP byte stream from one detached failure snapshot. */
export async function buildCapsuleArchive(request: CapsuleRequest): Promise<CapsuleArchive> {
  const cwd = request.session.cwd ?? process.cwd()
  const plugins = request.config.capturePlugins ? sortPlugins(request.plugins) : undefined
  const git = request.config.captureGit
    ? await collectGitEvidence(cwd, request.config.maxGitBytes)
    : { available: false as const, files: {} }
  const redactor = new Redactor([cwd, ...(git.root === undefined ? [] : [git.root])])
  const rawWindow = eventWindow(request)
  const safeTrigger = redactor.value(request.trigger) as FailureTrigger
  const safeEvents = rawWindow.map(event => redactor.value(event))
  const safeHeader = redactor.value(request.session.header)
  const capturedAt = new Date(request.trigger.time).toISOString()
  const runtime = redactor.value(await collectRuntimeEvidence(cwd, VERSION, capturedAt, plugins))
  const rawStack = request.trigger.error?.stack
  const stackTrace = request.config.resolveSourceMaps && typeof rawStack === 'string'
    ? await resolveStack(rawStack, { root: cwd, maxBytes: request.config.maxSourceMapBytes })
    : undefined
  const files: Record<string, string> = {
    'failure.json': json(safeTrigger),
    'session/header.json': json(safeHeader),
    'timeline.jsonl': safeEvents.map(event => JSON.stringify(event)).join('\n') + (safeEvents.length === 0 ? '' : '\n'),
    'runtime.json': json(runtime),
    'diagnosis.md': redactor.text(diagnosis(safeTrigger, git.available, safeEvents.length)),
    ...plugins === undefined ? {} : { 'plugins.json': json(redactor.value(plugins)) },
  }
  for (const [filename, contents] of Object.entries(git.files)) {
    files[filename] = redactor.text(contents)
  }
  if (!git.available && request.config.captureGit) {
    files['git/unavailable.txt'] = redactor.text(`${git.error ?? 'Git evidence unavailable.'}\n`)
  }
  if (stackTrace !== undefined) {
    const safeStack = redactor.value(stackTrace) as ResolvedStack
    files['stack-trace.json'] = json(safeStack)
    files['stack-trace.md'] = redactor.text(renderStackTrace(safeStack))
  }

  const redaction = redactor.report()
  files['redaction-report.json'] = json(redaction)
  const manifestFiles = ['manifest.json', ...Object.keys(files)].sort()
  const safeCwd = redactor.text(cwd)
  const manifest: CapsuleManifest = {
    schemaVersion: 1,
    generator: { name: 'dsh-failure-capsule', version: VERSION },
    createdAt: capturedAt,
    trigger: safeTrigger,
    session: {
      id: safeTrigger.sessionId,
      ...(safeCwd.length === 0 ? {} : { cwd: safeCwd }),
      eventCount: request.session.events.length,
      capturedEventCount: safeEvents.length,
    },
    evidence: { git: git.available, plugins: plugins !== undefined, stackTrace: stackTrace !== undefined },
    redaction,
    files: manifestFiles,
  }
  files['manifest.json'] = json(manifest)
  const bytes = zipSync(encoded(Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)))), {
    level: 6,
    mtime: ZIP_TIME,
  })
  return { bytes, manifest }
}

/** Build and atomically write one failure capsule. */
export async function writeFailureCapsule(request: CapsuleRequest): Promise<CapsuleResult> {
  const archive = await buildCapsuleArchive(request)
  const base = request.session.cwd ?? process.cwd()
  const outputDir = isAbsolute(request.config.outputDir)
    ? request.config.outputDir
    : join(base, request.config.outputDir)
  await mkdir(outputDir, { recursive: true })

  const timestamp = new Date(request.trigger.time).toISOString().replace(/[:.]/g, '-')
  const event = request.trigger.eventSeq === undefined ? 'live' : `event-${request.trigger.eventSeq}`
  const filename = `${timestamp}_${safeFilename(archive.manifest.session.id)}_${request.trigger.kind}_${event}.zip`
  const target = join(outputDir, filename)
  const temporary = join(outputDir, `.${filename}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, archive.bytes, { flag: 'wx' })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return { path: target, bytes: archive.bytes.byteLength, manifest: archive.manifest }
}
