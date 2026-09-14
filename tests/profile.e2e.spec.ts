import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshBin = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe.skipIf(!existsSync(dshBin))('packed DSH profile', () => {
  it('installs the bundle, boots it through DSH, and writes a failure capsule', async () => {
    const root = await mkdtemp(join(tmpdir(), 'failure-capsule-profile-'))
    roots.push(root)
    const home = join(root, 'home')
    const project = join(root, 'project')
    await mkdir(project)

    const packed = JSON.parse(execFileSync(
      process.execPath,
      [join(dirname(process.execPath), 'npm'), 'pack', '--ignore-scripts', '--json', '--pack-destination', root],
      { cwd: repoRoot, encoding: 'utf8' },
    )) as Record<string, { filename: string }>
    const packedManifest = Object.values(packed)[0]
    expect(packedManifest).toBeDefined()
    const tarball = join(root, packedManifest!.filename)
    const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }

    const install = spawnSync(process.execPath, [
      dshBin, 'plugin', '--profile', 'capsule-e2e', 'add', tarball,
    ], { cwd: project, env, encoding: 'utf8', timeout: 60_000 })
    expect(install.status, install.stderr).toBe(0)

    const profileDir = join(home, 'profiles', 'capsule-e2e')
    const fixtureDir = join(profileDir, 'node_modules', 'failure-trigger-bundle')
    await mkdir(fixtureDir, { recursive: true })
    await writeFile(join(fixtureDir, 'package.json'), JSON.stringify({
      name: 'failure-trigger-bundle',
      version: '0.0.0',
      type: 'module',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    await writeFile(join(fixtureDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: session',
      "      name: '@deepseek-ai/dsh-session'",
      '    - id: failure-trigger',
      '      name: failure-trigger-bundle/trigger.mjs',
      '',
    ].join('\n'))
    await writeFile(join(fixtureDir, 'trigger.mjs'), [
      "export const name = 'failure-trigger'",
      "export const inject = ['sessions', 'loader']",
      'export function apply(ctx) {',
      '  void ctx.loader.await().then(() => {',
      "    const session = ctx.sessions.create('profile-e2e', { meta: { cwd: process.cwd() } })",
      "    session.append('tool/result', {",
      '      turn: 1, step: 1,',
      "      message: { id: 'result-1', role: 'user', source: { kind: 'tool', tool: 'bash' },",
      "        content: [{ type: 'tool-result', toolCallId: 'call-1', isError: true,",
      "          content: [{ type: 'text', text: 'profile e2e failure' }] }] },",
      "      error: { name: 'ProfileE2EError', code: 'PROFILE_E2E_FAILURE' },",
      "    }, { surfaceOp: 'append' })",
      "    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50)",
      '  })',
      '}',
      '',
    ].join('\n'))

    const manifestPath = join(profileDir, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[]; patchReload?: string } }
    }
    manifest.dependencies['failure-trigger-bundle'] = '0.0.0'
    manifest.dsh.profile.bundles = ['dsh-failure-capsule', 'failure-trigger-bundle']
    manifest.dsh.profile.patchReload = 'startup'
    await writeFile(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')

    const dump = spawnSync(process.execPath, [dshBin, '--profile', 'capsule-e2e', '--dump-config'], {
      cwd: project, env, encoding: 'utf8', timeout: 30_000,
    })
    expect(dump.status, dump.stderr).toBe(0)
    expect(dump.stdout).toContain('id: failure-capsule')
    expect(dump.stdout).toContain('id: failure-trigger')

    const run = spawnSync(process.execPath, [dshBin, '--profile', 'capsule-e2e'], {
      cwd: project, env, encoding: 'utf8', timeout: 30_000,
    })
    expect(run.status, run.stderr).toBe(0)

    const outputDir = join(project, '.dsh', 'failure-capsules')
    const files = await readdir(outputDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/profile-e2e_tool-error_event-0\.zip$/)
    const archive = unzipSync(await readFile(join(outputDir, files[0]!)))
    const failure = JSON.parse(new TextDecoder().decode(archive['failure.json'])) as { kind: string; error?: { code: string } }
    expect(failure).toMatchObject({ kind: 'tool-error', error: { code: 'PROFILE_E2E_FAILURE' } })
  }, 120_000)
})
