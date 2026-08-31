<div align="center">

# dsh-failure-capsule

**Failure evidence, before the context disappears.**

A local-first DeepSeek Harness plugin that seals failed agent work into a redacted, reviewable evidence ZIP.

[![npm](https://img.shields.io/npm/v/dsh-failure-capsule.svg)](https://www.npmjs.com/package/dsh-failure-capsule)
[![CI](https://github.com/YiHarvest/dsh-failure-capsule/actions/workflows/ci.yml/badge.svg)](https://github.com/YiHarvest/dsh-failure-capsule/actions/workflows/ci.yml)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.1.2--alpha.2-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[npm](https://www.npmjs.com/package/dsh-failure-capsule) · [Changelog](CHANGELOG.md) · [简体中文](README.md)

</div>

> **Release status:** v0.2.2 is a standard Profile Bundle verified against `@deepseek-ai/dsh@0.1.2-alpha.2`. It observes the native `session/event`, `agent/error`, and Loader inventory interfaces without patching Harness core. Capture stays local, does not call a model, and has no telemetry backend.

<img src="assets/failure-capsule-demo.svg" alt="A failed Harness event is collected, redacted locally, and sealed into a Failure Capsule ZIP with its timeline, Git state, runtime, plugins, and resolved stack trace.">

## Try the current release

Web and headless are separate profiles. Install the bundle in every profile that should capture failures:

```bash
dsh plugin --profile web add dsh-failure-capsule
dsh plugin --profile headless add dsh-failure-capsule
```

Confirm that the layer is present:

```bash
dsh --profile web --dump-config
# Look for: id: failure-capsule / name: dsh-failure-capsule
```

There is no extra command to run. Keep using Harness normally. A matching failure writes a capsule beneath the session workspace:

```text
.dsh/failure-capsules/
└── 2026-08-31T01-23-45-678Z_<session>_tool-error_event-87.zip
```

## The idea

A final error line rarely explains an agent failure. The useful context is spread across the preceding tool calls, turn boundary, repository state, runtime, active plugins, and sometimes a minified stack trace.

Failure Capsule captures that context while it still exists:

1. Observe a native durable or live failure signal.
2. Snapshot a bounded window of session and environment evidence.
3. Resolve local source maps when a JavaScript stack is available.
4. Redact credentials, private paths, and sensitive fields from the exported copy.
5. Write one deterministic, self-indexing ZIP for review or sharing.

## Why another debugging tool?

| Tool category | It usually preserves | What Failure Capsule adds |
|---|---|---|
| Terminal output | The last command and its stderr | The agent timeline that led to the failure |
| Harness session log | Durable interaction events | Git, runtime, plugin inventory, triage notes, and one portable archive |
| Error tracker | Exceptions sent to a backend | Local-only capture with no service or account |
| Core instrumentation patch | Product-specific internal state | A removable Profile Bundle on public Harness extension points |
| **Failure Capsule** | **A failed tool call or turn** | **One bounded, redacted evidence package at the point of failure** |

The plugin is not an error tracker, log shipper, or AI diagnosis service. It prepares the evidence a person or another tool needs to investigate.

## Keep it enabled

Profile installation is persistent, but profiles are independent. Installing the bundle for `web` does not enable it for `headless`, and vice versa.

The default triggers are deliberately narrow:

| Signal | Default | Result |
|---|---:|---|
| Failed `tool/result` | On | One capsule per failed tool call |
| `turn/end` with `error` | On | Captures model, transport, or agent-turn failure |
| `turn/end` with `blocked` | On | Captures a policy or workflow block |
| `turn/end` with `interrupted` | On | Captures a turn left open by an earlier process |
| Live `agent/error` without a durable failed turn | On | Captures runtime errors that would otherwise disappear |
| `turn/end` with `aborted` | Off | User cancellation is excluded unless explicitly enabled |

Each event is deduplicated for the plugin lifetime. A live `agent/error` waits briefly for the corresponding durable `turn/end`, preventing two archives for one failure.

## Use the current plugin

The bundle is ambient: install it, configure it if needed, then inspect the generated ZIPs with ordinary archive and text tools.

```bash
# Install from npm
dsh plugin --profile web add dsh-failure-capsule

# Verify the composed profile
dsh --profile web --dump-config

# Test an unpublished local build
npm pack
dsh plugin --profile web add ./dsh-failure-capsule-0.2.2.tgz
```

Relative output paths resolve from the session working directory. Absolute paths are also accepted.

## What v0.2.2 ships

| Shipped surface | Release evidence |
|---|---|
| Harness `0.1.2-alpha.2` compatibility | Type checking and real Cordis `SessionStore` integration against the published packages |
| Failed tool, failed turn, interruption, block, and live agent-error triggers | Focused classification and lifecycle tests |
| Bounded timeline, Git, runtime, and plugin evidence | Deterministic ZIP assertions and command-budget tests |
| Local source-map resolution | Parsed-frame, mapped-frame, missing-map, and size-limit tests |
| Credential and path redaction | Rule-level redaction tests plus archive-level assertions |
| Atomic writes and unload draining | Filesystem and plugin-disposal integration coverage |

The archive schema remains version `1`; v0.2.2 updates the verified Harness dependency baseline without changing the capsule format.

## How capsules work

`session/event` is the durable source. Failed tool results and terminal turn reasons can trigger immediately. `agent/error` is a live fallback for failures that never produce a durable failed-turn record.

At capture time the plugin detaches the current session header and event list, records the Loader inventory, and performs bounded read-only Git commands. It never reads untracked file contents, invokes a shell, runs Git hooks, or enables text conversion. Every Git command has its own output budget.

If the failure carries a JavaScript stack, the plugin parses its frames and looks for adjacent local source maps. Map reads are byte-bounded and never use the network. The archive retains both structured frames and a readable Markdown rendering with available source context.

All evidence passes through redaction before ZIP assembly. The original session log, repository, and stack are not rewritten.

## Release roadmap

The current release focuses on faithful local capture and a stable evidence format. Future work is tracked in the public [issue tracker](https://github.com/YiHarvest/dsh-failure-capsule/issues); likely directions include richer failure correlation, more evidence adapters, and reader tooling that does not weaken the local-first security model.

Compatibility claims are tied to reproducible tests and named Harness releases. A future Harness prerelease is not treated as supported until this package has been checked against it.

## Privacy

Failure Capsule has no network client and no telemetry backend. Its normal operation reads local session state, Loader metadata, selected runtime facts, local source maps, and bounded Git output, then writes a ZIP to the configured local directory.

The exported copy redacts:

- sensitive object fields and environment assignments;
- Bearer and Basic authorization values;
- common provider, GitHub, npm, and AWS credential forms;
- credentials embedded in URLs;
- private-key blocks;
- local home-directory paths.

The redaction report contains counts by rule, never the matched secret. Redaction is defense in depth, not proof that arbitrary source diffs or free-form model text contain no business secrets. Review a capsule before sharing it outside its original trust boundary.

Capture limits protect the agent loop and the resulting artifact. The default timeline contains at most 80 events, each Git command is limited to 512 KiB, and a single source-map read is limited to 4 MiB. Capture failure produces a Harness warning and does not replace the original agent failure.

## Configuration

Override the bundle row with the same id in a later profile patch:

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
    resolveSourceMaps: true
    maxSourceMapBytes: 4194304
```

| Field | Default | Accepted values |
|---|---:|---|
| `outputDir` | `.dsh/failure-capsules` | Non-empty relative or absolute path without NUL |
| `maxEvents` | `80` | Integer from `1` to `10000` |
| `maxGitBytes` | `524288` | Integer from `1024` to `16777216` |
| `captureGit` | `true` | Boolean |
| `capturePlugins` | `true` | Boolean |
| `triggerOnToolError` | `true` | Boolean |
| `triggerOnTurnFailure` | `true` | Boolean |
| `triggerOnAborted` | `false` | Boolean |
| `triggerOnAgentError` | `true` | Boolean |
| `resolveSourceMaps` | `true` | Boolean |
| `maxSourceMapBytes` | `4194304` | Integer from `1024` to `67108864` |

Invalid configuration fails plugin load instead of silently changing behavior.

## Capsule contents

```text
failure-capsule.zip
├── manifest.json              Schema, trigger, file index, and redaction counts
├── failure.json               Structured failure identity
├── timeline.jsonl             Bounded events through the failure
├── diagnosis.md               Deterministic, model-free triage entry points
├── runtime.json               Node, OS, architecture, and project package facts
├── plugins.json               Loader entries, enabled state, and fiber phase
├── redaction-report.json      Safe replacement counts by rule
├── stack-trace.json           Parsed and source-mapped frames, when available
├── stack-trace.md             Readable frames and source context
├── session/header.json        Session cwd, lineage, and format version
└── git/
    ├── head.txt
    ├── branch.txt
    ├── status.txt
    ├── recent-commits.txt
    ├── working-tree.patch
    └── index.patch
```

## Contributing

Node `^22.19.0 || >=24.0.0` is required. For local verification:

```bash
npm install
npm run check
npm pack --dry-run
```

`npm run check` runs strict type checking, all tests, and the production build. `prepack` repeats the same gate before a package is created.

## License

[MIT](LICENSE) © 2026-present [YiHarvest](https://github.com/YiHarvest)
