import { homedir } from 'node:os'
import type { RedactionReport } from './types.ts'

interface TextRule {
  name: string
  pattern: RegExp
  replacement: string
}

const SENSITIVE_FIELD = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|password|passwd|secret|client[_-]?secret|private[_-]?key|cookie|set-cookie|npm[_-]?token)$/i

const TEXT_RULES: readonly TextRule[] = [
  {
    name: 'private-key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: '<redacted:private-key>',
  },
  {
    name: 'sensitive-property',
    pattern: /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|passwd|secret|client[_-]?secret|private[_-]?key|npm[_-]?token)\b\s*[:=]\s*["']?)([^"'\s,;}]+)/gi,
    replacement: '$1<redacted:value>',
  },
  {
    name: 'authorization',
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: '$1 <redacted:credential>',
  },
  {
    name: 'provider-token',
    pattern: /\b(?:(?:sk|ds)[_-]|gh[opusr]_|github_pat_|npm_)[A-Za-z0-9_-]{16,}\b/g,
    replacement: '<redacted:token>',
  },
  {
    name: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: '<redacted:aws-access-key>',
  },
  {
    name: 'sensitive-assignment',
    pattern: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD))\s*=\s*(?:"[^"]*"|'[^']*'|[^\s;]+)/g,
    replacement: '$1=<redacted:value>',
  },
  {
    name: 'npmrc-auth-token',
    pattern: /(\/\/[A-Za-z0-9./:_-]+:_authToken\s*=\s*)[^\s]+/gi,
    replacement: '$1<redacted:value>',
  },
  {
    name: 'url-credentials',
    pattern: /\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
    replacement: '$1<redacted:credentials>@',
  },
]

function replaceAndCount(
  input: string,
  pattern: RegExp,
  replacement: string,
): { text: string; count: number } {
  let count = 0
  const text = input.replace(pattern, (...args: unknown[]) => {
    count += 1
    const match = args[0]
    if (typeof replacement === 'string' && replacement.includes('$1')) {
      const group = args[1]
      return replacement.replace('$1', typeof group === 'string' ? group : '')
    }
    return typeof match === 'string' ? replacement : replacement
  })
  return { text, count }
}

/** Stateful redactor that accumulates safe per-rule counters. */
export class Redactor {
  private readonly counts = new Map<string, number>()
  private readonly pathRules: readonly TextRule[]

  constructor(extraPrivatePaths: readonly string[] = []) {
    const paths = [
      { path: homedir(), name: 'home-path', replacement: '<home>' },
      ...extraPrivatePaths.map(path => ({ path, name: 'private-path', replacement: '<workspace>' })),
    ]
      .filter(entry => entry.path.length > 1)
      .sort((left, right) => right.path.length - left.path.length)
    this.pathRules = paths.map(entry => ({
      name: entry.name,
      pattern: new RegExp(escapeRegExp(entry.path), 'g'),
      replacement: entry.replacement,
    }))
  }

  /** Redact credentials and private paths from one string. */
  text(input: string): string {
    let output = input
    for (const rule of [...TEXT_RULES, ...this.pathRules]) {
      const result = replaceAndCount(output, rule.pattern, rule.replacement)
      output = result.text
      this.increment(rule.name, result.count)
    }
    return output
  }

  /** Redact a detached JSON-like value without retaining aliases. */
  value(input: unknown): unknown {
    if (typeof input === 'string') return this.text(input)
    if (Array.isArray(input)) return input.map(value => this.value(value))
    if (input === null || typeof input !== 'object') return input

    const output: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) {
      if (SENSITIVE_FIELD.test(key)) {
        output[key] = '<redacted:field>'
        this.increment('sensitive-field', 1)
      } else {
        output[key] = this.value(value)
      }
    }
    return output
  }

  /** Return sorted counters that reveal no removed material. */
  report(): RedactionReport {
    const byRule = Object.fromEntries([...this.counts].sort(([left], [right]) => left.localeCompare(right)))
    return {
      total: Object.values(byRule).reduce((sum, value) => sum + value, 0),
      byRule,
    }
  }

  private increment(rule: string, count: number): void {
    if (count === 0) return
    this.counts.set(rule, (this.counts.get(rule) ?? 0) + count)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
