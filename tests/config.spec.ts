import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('applies safe defaults and accepts explicit overrides', () => {
    expect(resolveConfig()).toEqual(DEFAULT_CONFIG)
    expect(resolveConfig({ maxEvents: 12, captureGit: false })).toMatchObject({
      maxEvents: 12,
      captureGit: false,
    })
  })

  it('rejects empty paths and out-of-budget integers', () => {
    expect(() => resolveConfig({ outputDir: '  ' })).toThrow('outputDir')
    expect(() => resolveConfig({ maxEvents: 0 })).toThrow('maxEvents')
    expect(() => resolveConfig({ maxGitBytes: 999 })).toThrow('maxGitBytes')
    expect(() => resolveConfig({ maxEvents: 1.5 })).toThrow('maxEvents')
  })
})
