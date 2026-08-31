import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('GitHub Packages staging', () => {
  it('scopes the packed package and its profile loader entry', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'dsh-github-package-'))
    temporaryDirectories.push(directory)

    await Promise.all([
      writeFile(
        resolve(directory, 'package.json'),
        JSON.stringify({
          name: 'dsh-failure-capsule',
          version: '0.2.2',
          publishConfig: { access: 'public' },
        }),
      ),
      writeFile(
        resolve(directory, 'cordis.patch.yml'),
        '- insert:\n    - id: failure-capsule\n      name: dsh-failure-capsule\n',
      ),
    ])

    await execFileAsync(process.execPath, [
      resolve('scripts/configure-github-package.mjs'),
      directory,
    ])

    const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
    const patch = await readFile(resolve(directory, 'cordis.patch.yml'), 'utf8')

    expect(manifest).toMatchObject({
      name: '@yiharvest/dsh-failure-capsule',
      version: '0.2.2',
      publishConfig: {
        access: 'public',
        registry: 'https://npm.pkg.github.com',
      },
    })
    expect(patch).toContain("name: '@yiharvest/dsh-failure-capsule'")
    expect(patch).not.toContain('name: dsh-failure-capsule')
  })
})
