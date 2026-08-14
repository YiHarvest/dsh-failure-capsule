# dsh-failure-capsule

A local-first DeepSeek Harness plugin that turns a failed tool call or agent turn into a redacted evidence ZIP: the bounded execution timeline, Git state, runtime metadata, and active plugin inventory in one place.

[简体中文](README.md)

[![npm](https://img.shields.io/npm/v/dsh-failure-capsule.svg)](https://www.npmjs.com/package/dsh-failure-capsule)
[![CI](https://github.com/YiHarvest/dsh-failure-capsule/actions/workflows/ci.yml/badge.svg)](https://github.com/YiHarvest/dsh-failure-capsule/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Status:** standard Profile Bundle for `@deepseek-ai/dsh@0.1.0-rc.6`. It uses native `session/event` and `agent/error` extension points, never patches Harness core, never uploads data, and never calls a model for diagnosis.

## Quick start

Web and headless are separate profiles, so install the plugin in each profile that should capture failures:

```sh
dsh plugin --profile web add dsh-failure-capsule
dsh plugin --profile headless add dsh-failure-capsule

dsh --profile web --dump-config
# Expect id: failure-capsule / name: dsh-failure-capsule
```

Capsules appear under the session workspace by default:

```text
.dsh/failure-capsules/
└── 2026-08-14T08-20-31-123Z_<session>_tool-error_event-42.zip
```

## What gets captured

The default triggers are failed `tool/result` events, `error` / `blocked` / `interrupted` turn endings, and live `agent/error` signals that have no durable failed-turn record. User cancellation is excluded unless `triggerOnAborted` is enabled.

Each ZIP contains:

| File | Evidence |
|---|---|
| `manifest.json` | Schema version, trigger, file index, and redaction counts |
| `failure.json` | Structured failure identity |
| `timeline.jsonl` | Up to 80 session events ending at the failure |
| `diagnosis.md` | Deterministic, model-free triage entry points |
| `runtime.json` | Node, OS, architecture, and project package metadata |
| `plugins.json` | Loader entries, enabled state, and fiber phase |
| `session/header.json` | Session cwd, lineage, and format version |
| `git/*` | HEAD, branch, status, recent commits, working-tree diff, staged diff |
| `redaction-report.json` | Safe per-rule replacement counts |

Git collection is read-only and shell-free. It does not inspect untracked file contents, run hooks, or run textconv. Each command has a 512 KiB output budget by default.

## Security model

- Local files only; no network client and no telemetry backend.
- Redaction touches the exported copy, never the canonical session log or workspace.
- Sensitive fields, common service/GitHub/npm tokens, authorization headers, AWS access keys, environment assignments, URL credentials, private-key blocks, and local paths are redacted.
- Capture work is bounded and isolated from the agent loop.
- In-flight archive writes drain during plugin disposal.

Automated redaction cannot prove that free-form text or source diffs contain no business secrets. Review a capsule before sharing it.

## Configuration

Override the bundle row with the same id in the profile patch:

```yaml
- id: failure-capsule
  name: dsh-failure-capsule
  config:
    outputDir: .dsh/failure-capsules
    maxEvents: 80
    maxGitBytes: 524288
    captureGit: true
    capturePlugins: true
    triggerOnToolError: true
    triggerOnTurnFailure: true
    triggerOnAborted: false
    triggerOnAgentError: true
```

Relative `outputDir` values resolve from the session cwd. `maxEvents` accepts `1..10000`; `maxGitBytes` accepts `1024..16777216`. Invalid configuration fails plugin load.

## Development

Node `^22.19.0 || >=24.0.0` is required:

```sh
npm install
npm run check
npm pack
```

Tests cover redaction, failure classification, configuration limits, bounded Git collection, deterministic ZIP output, atomic writes, and safe filenames. `prepack` reruns type checking, tests, and the build.

The repository uses the `dsh-plugin` topic and declares `dsh.bundle.patch`, so the [Awesome DSH Plugins Radar](https://github.com/AdamPlatin123/awesome-dsh-plugins) can discover it automatically.

## License

[MIT](LICENSE)
