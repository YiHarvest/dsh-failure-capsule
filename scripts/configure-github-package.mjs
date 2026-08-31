import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageDirectory = process.argv[2]

if (!packageDirectory) {
  throw new Error('Usage: node scripts/configure-github-package.mjs <package-directory>')
}

const manifestPath = resolve(packageDirectory, 'package.json')
const patchPath = resolve(packageDirectory, 'cordis.patch.yml')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

if (manifest.name !== 'dsh-failure-capsule') {
  throw new Error(`Expected package name dsh-failure-capsule, received ${manifest.name}`)
}

manifest.name = '@yiharvest/dsh-failure-capsule'
manifest.publishConfig = {
  ...manifest.publishConfig,
  access: 'public',
  registry: 'https://npm.pkg.github.com',
}

const patch = await readFile(patchPath, 'utf8')
const loaderName = /^([ \t]+name: )dsh-failure-capsule$/gm
const matches = [...patch.matchAll(loaderName)]

if (matches.length !== 1) {
  throw new Error(`Expected one dsh-failure-capsule loader entry, received ${matches.length}`)
}

await Promise.all([
  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(patchPath, patch.replace(loaderName, "$1'@yiharvest/dsh-failure-capsule'")),
])
