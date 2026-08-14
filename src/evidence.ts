import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginInventoryEntry } from './types.ts'

/** Result of one bounded, shell-free evidence command. */
export interface CommandEvidence {
  ok: boolean
  stdout: string
  stderr: string
  truncated: boolean
  error?: string
}

/** Git files included in one capsule, or the reason Git was unavailable. */
export interface GitEvidence {
  available: boolean
  root?: string
  files: Record<string, string>
  error?: string
}

function appendBounded(chunks: Buffer[], chunk: Buffer, state: { bytes: number }, limit: number): boolean {
  const remaining = limit - state.bytes
  if (remaining <= 0) return true
  chunks.push(chunk.subarray(0, remaining))
  state.bytes += Math.min(chunk.length, remaining)
  return chunk.length > remaining
}

/** Execute without a shell, cap output, and stop commands that exceed their evidence budget. */
export function runBoundedCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  maxBytes: number,
  timeoutMs = 5_000,
): Promise<CommandEvidence> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const stdoutState = { bytes: 0 }
    const stderrState = { bytes: 0 }
    let truncated = false
    let spawnError: Error | undefined
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    timer.unref()

    child.stdout.on('data', (value: Buffer) => {
      if (appendBounded(stdout, value, stdoutState, maxBytes)) {
        truncated = true
        child.kill()
      }
    })
    child.stderr.on('data', (value: Buffer) => {
      if (appendBounded(stderr, value, stderrState, Math.min(maxBytes, 64 * 1024))) truncated = true
    })
    child.on('error', error => {
      spawnError = error
    })
    child.on('close', code => {
      clearTimeout(timer)
      const error = timedOut
        ? `command timed out after ${timeoutMs}ms`
        : spawnError?.message
      resolve({
        ok: code === 0 && error === undefined,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated,
        ...(error === undefined ? {} : { error }),
      })
    })
  })
}

async function git(cwd: string, args: readonly string[], maxBytes: number): Promise<CommandEvidence> {
  return runBoundedCommand('git', ['-C', cwd, ...args], cwd, maxBytes)
}

function renderCommandEvidence(result: CommandEvidence): string {
  const sections = [result.stdout]
  if (result.stderr.length > 0) sections.push(`\n[stderr]\n${result.stderr}`)
  if (result.error !== undefined) sections.push(`\n[collector-error]\n${result.error}`)
  if (result.truncated) sections.push('\n[truncated by failure-capsule evidence budget]\n')
  return sections.join('').trimEnd() + '\n'
}

/** Collect read-only Git identity, status, and working-tree patches. */
export async function collectGitEvidence(cwd: string, maxBytes: number): Promise<GitEvidence> {
  const rootResult = await git(cwd, ['rev-parse', '--show-toplevel'], 64 * 1024)
  if (!rootResult.ok) {
    return {
      available: false,
      files: {},
      error: rootResult.error ?? (rootResult.stderr.trim() || 'not a Git working tree'),
    }
  }

  const root = rootResult.stdout.trim()
  const commands = {
    'git/head.txt': ['rev-parse', 'HEAD'],
    'git/branch.txt': ['branch', '--show-current'],
    'git/status.txt': ['status', '--short', '--branch', '--untracked-files=all'],
    'git/recent-commits.txt': ['log', '-5', '--date=iso-strict', '--format=%H%x09%aI%x09%s'],
    'git/working-tree.patch': ['diff', '--no-ext-diff', '--no-textconv', '--'],
    'git/index.patch': ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--'],
  } as const
  const entries = await Promise.all(Object.entries(commands).map(async ([filename, args]) => {
    const result = await git(root, args, maxBytes)
    return [filename, renderCommandEvidence(result)] as const
  }))
  return { available: true, root, files: Object.fromEntries(entries) }
}

async function nearestPackage(cwd: string): Promise<{ name?: string; version?: string }> {
  try {
    const parsed = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>
    return {
      ...(typeof parsed['name'] === 'string' ? { name: parsed['name'] } : {}),
      ...(typeof parsed['version'] === 'string' ? { version: parsed['version'] } : {}),
    }
  } catch {
    return {}
  }
}

/** Build a small runtime snapshot without exporting environment values. */
export async function collectRuntimeEvidence(
  cwd: string,
  pluginVersion: string,
  capturedAt: string,
  plugins: readonly PluginInventoryEntry[] | undefined,
): Promise<Record<string, unknown>> {
  const project = await nearestPackage(cwd)
  return {
    capturedAt,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      versions: {
        node: process.versions.node,
        v8: process.versions.v8,
        uv: process.versions.uv,
      },
    },
    plugin: { name: 'dsh-failure-capsule', version: pluginVersion },
    cwd,
    project,
    ...(plugins === undefined ? {} : { plugins }),
  }
}
