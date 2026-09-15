import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface WorkflowJob {
  environment?: string
  needs?: string | string[]
  permissions?: Record<string, string>
}

interface ReleaseWorkflow {
  on: {
    push?: { branches?: string[]; tags?: string[] }
    workflow_dispatch?: unknown
  }
  permissions: Record<string, string>
  jobs: Record<string, WorkflowJob>
}

describe('release workflow', () => {
  const source = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
  const workflow = parse(source) as ReleaseWorkflow

  it('publishes only from a version tag or an explicit retry', () => {
    expect(workflow.on.push?.branches).toBeUndefined()
    expect(workflow.on.push?.tags).toEqual(['v*'])
    expect(workflow.on.workflow_dispatch).toBeDefined()
    expect(source).toContain('if [[ "$GITHUB_REF" != "refs/tags/$RELEASE_TAG" ]]')
  })

  it('limits elevated permissions to the job that needs them', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs['publish-npm']).toMatchObject({
      environment: 'release',
      permissions: { contents: 'read', 'id-token': 'write' },
    })
    expect(workflow.jobs['publish-github-package']?.permissions).toEqual({
      contents: 'read',
      packages: 'write',
    })
    expect(workflow.jobs['github-release']?.permissions).toEqual({ contents: 'write' })
  })

  it('creates the public release only after both registries succeed', () => {
    expect(workflow.jobs['publish-npm']?.needs).toBe('prepare')
    expect(workflow.jobs['publish-github-package']?.needs).toEqual(['prepare', 'publish-npm'])
    expect(workflow.jobs['github-release']?.needs).toEqual([
      'prepare',
      'publish-npm',
      'publish-github-package',
    ])
  })

  it('verifies the shared artifact and rejects same-version content drift', () => {
    expect(source.match(/sha256sum -c SHA256SUMS/g)).toHaveLength(3)
    expect(source).toContain('exists with different content')
    expect(source).toContain('dist.integrity')
    expect(source.match(/tarball="\.\/dist\/dsh-failure-capsule-\$PACKAGE_VERSION\.tgz"/g)).toHaveLength(2)
  })
})
