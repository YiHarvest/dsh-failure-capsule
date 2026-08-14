import { DEFAULT_MAX_SOURCE_MAP_BYTES } from './sourcemap.ts'
import type { Config, ResolvedConfig } from './types.ts'

/** Default output and evidence limits used by the Profile Bundle. */
export const DEFAULT_CONFIG: Readonly<ResolvedConfig> = Object.freeze({
  outputDir: '.dsh/failure-capsules',
  maxEvents: 80,
  maxGitBytes: 512 * 1024,
  captureGit: true,
  capturePlugins: true,
  triggerOnToolError: true,
  triggerOnTurnFailure: true,
  triggerOnAborted: false,
  triggerOnAgentError: true,
  resolveSourceMaps: true,
  maxSourceMapBytes: DEFAULT_MAX_SOURCE_MAP_BYTES,
})

function boundedInteger(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`failure-capsule: ${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

/** Apply defaults and reject unsafe or nonsensical tunables at plugin load. */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const outputDir = config.outputDir ?? DEFAULT_CONFIG.outputDir
  if (outputDir.trim().length === 0) {
    throw new TypeError('failure-capsule: outputDir must not be empty')
  }
  if (outputDir.includes('\0')) {
    throw new TypeError('failure-capsule: outputDir must not contain NUL')
  }

  return {
    outputDir,
    maxEvents: boundedInteger('maxEvents', config.maxEvents ?? DEFAULT_CONFIG.maxEvents, 1, 10_000),
    maxGitBytes: boundedInteger(
      'maxGitBytes',
      config.maxGitBytes ?? DEFAULT_CONFIG.maxGitBytes,
      1024,
      16 * 1024 * 1024,
    ),
    captureGit: config.captureGit ?? DEFAULT_CONFIG.captureGit,
    capturePlugins: config.capturePlugins ?? DEFAULT_CONFIG.capturePlugins,
    triggerOnToolError: config.triggerOnToolError ?? DEFAULT_CONFIG.triggerOnToolError,
    triggerOnTurnFailure: config.triggerOnTurnFailure ?? DEFAULT_CONFIG.triggerOnTurnFailure,
    triggerOnAborted: config.triggerOnAborted ?? DEFAULT_CONFIG.triggerOnAborted,
    triggerOnAgentError: config.triggerOnAgentError ?? DEFAULT_CONFIG.triggerOnAgentError,
    resolveSourceMaps: config.resolveSourceMaps ?? DEFAULT_CONFIG.resolveSourceMaps,
    maxSourceMapBytes: boundedInteger(
      'maxSourceMapBytes',
      config.maxSourceMapBytes ?? DEFAULT_CONFIG.maxSourceMapBytes,
      1024,
      64 * 1024 * 1024,
    ),
  }
}
