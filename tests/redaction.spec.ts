import { describe, expect, it } from 'vitest'
import { Redactor } from '../src/redaction.ts'

describe('Redactor', () => {
  it('removes credential fields, tokens, URL credentials, keys, and private paths', () => {
    const redactor = new Redactor(['/workspace/private'])
    const safe = redactor.value({
      apiKey: 'field-secret',
      nested: {
        command: 'DEEPSEEK_API_KEY=super-secret-value',
        quotedCommand: 'OPENAI_API_KEY="quoted-secret-value"',
        auth: 'Bearer abcdefghijklmnopqrstuvwxyz',
        url: 'https://alice:hunter2@example.com/path',
        token: 'npm_abcdefghijklmnopqrstuvwxyz',
        config: 'api-key: sk-live-abcdefghijklmnopqrstuvwxyz',
        npmrc: '//registry.npmjs.org/:_authToken=npm_zyxwvutsrqponmlkjihg',
        path: '/workspace/private/src/index.ts',
        privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      },
    })
    const rendered = JSON.stringify(safe)

    expect(rendered).not.toContain('field-secret')
    expect(rendered).not.toContain('super-secret-value')
    expect(rendered).not.toContain('quoted-secret-value')
    expect(rendered).not.toContain('sk-live-abcdefghijklmnopqrstuvwxyz')
    expect(rendered).not.toContain('zyxwvutsrqponmlkjihg')
    expect(rendered).not.toContain('hunter2')
    expect(rendered).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(rendered).not.toContain('/workspace/private')
    expect(rendered).not.toContain('BEGIN PRIVATE KEY')
    expect(rendered).toContain('<redacted:field>')
    expect(rendered).toContain('<workspace>')
    expect(redactor.report().total).toBeGreaterThanOrEqual(6)
  })

  it('returns stable, sorted redaction counters', () => {
    const redactor = new Redactor([])
    redactor.text('Bearer abcdefghijklmnop npm_abcdefghijklmnop')
    expect(Object.keys(redactor.report().byRule)).toEqual(['authorization', 'provider-token'])
  })
})
