import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { collectGitEvidence, runBoundedCommand } from '../src/evidence.ts'

const exec = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('evidence collection', () => {
  it('collects read-only Git state and working-tree diffs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'failure-capsule-git-'))
    roots.push(root)
    await exec('git', ['init', '-q'], { cwd: root })
    await writeFile(join(root, 'tracked.txt'), 'before\n')
    await exec('git', ['add', 'tracked.txt'], { cwd: root })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'initial'], { cwd: root })
    await writeFile(join(root, 'tracked.txt'), 'after\n')

    const evidence = await collectGitEvidence(root, 32 * 1024)
    expect(evidence.available).toBe(true)
    expect(evidence.files['git/status.txt']).toContain('tracked.txt')
    expect(evidence.files['git/working-tree.patch']).toContain('+after')
    expect(evidence.files['git/index.patch']).toBe('\n')
  })

  it('caps command output and marks truncation', async () => {
    const result = await runBoundedCommand(
      process.execPath,
      ['-e', "process.stdout.write('x'.repeat(200000))"],
      process.cwd(),
      1024,
    )
    expect(result.stdout.length).toBe(1024)
    expect(result.truncated).toBe(true)
  })
})
