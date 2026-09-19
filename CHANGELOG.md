# Changelog

All notable changes to this project are documented in this file.

## Unreleased

- Retain bounded failure timelines incrementally from `session/event` instead of relying on the deprecated synchronous `Session.snapshotEvents()` history reader.
- Verify plugin unload cleanup and preserve total observed event counts when only a bounded timeline window is retained.
- Add a non-blocking CI compatibility canary for the latest published DeepSeek Harness alpha while keeping `0.1.5-rc.2` as the supported baseline.

## 0.2.4 - 2026-09-14

- Make releases tag-driven and resumable, with separate validation, npm, GitHub Packages, and GitHub Release jobs sharing one verified tarball.
- Bind npm trusted publishing to the protected `release` environment instead of attempting a publish on every push to `main`.
- Verify the packed plugin against DeepSeek Harness `0.1.5-rc.2` through a real isolated DSH profile boot, failure event, shutdown drain, and ZIP-content assertion.
- Add a compatibility reader for the current `Session.snapshotEvents()` contract and the legacy `Session.events` contract used by older Harness installations.
- Run the packed-profile E2E as part of `npm run check` and CI, without requiring model credentials or network inference.

## 0.2.3 - 2026-09-09

- Verify the plugin against the latest DeepSeek Harness source release, `0.1.5-alpha.2` (`b2e3b2a`), and its published npm dependency graph.
- Replace direct access to the removed public `Session.events` property with the immutable `Session.snapshotEvents()` API introduced by the current Harness session contract.
- Regenerate the development dependency graph at `0.1.5-alpha.2` so Agent and Session peer-contract drift is detected by focused integration tests.
- Publish releases to both npm and GitHub Packages through the release workflow, with idempotent registry checks and automatic release tagging after a versioned change reaches `main`.

## 0.2.2 - 2026-08-31

- Verify the plugin against DeepSeek Harness `0.1.2-alpha.2`, including its current `session/event`, `agent/error`, and Loader inventory interfaces.
- Update the development baseline to Cordis `4.0.2`, Loader `1.0.3`, Schemastery `3.18.2`, and the Harness `0.1.2-alpha.2` packages.
- Keep type-only Cordis, Loader, Agent, and Session relationships development-only, matching the current Harness dependency-ownership rules and avoiding false missing-peer warnings in profiles.
- Reframe the bilingual README around the plugin workflow and add an original Failure Capsule evidence-flow SVG.

## 0.2.1 - 2026-08-18

- Verify the plugin against DeepSeek Harness `0.1.0-rc.7` and update the development dependency baseline.
- Add CI coverage for the supported Node.js release lines.
- Add a tag-driven GitHub Release workflow that validates the version and attaches the packed npm tarball.

## 0.2.0 - 2026-08-14

- Resolve minified JavaScript stack traces back to original source using local source maps.
- Resolve stacks synchronously and local-first with `@jridgewell/trace-mapping` and bounded `.map` file reads, with no network access.
- Capture raw `Error.stack` on live agent errors and emit `stack-trace.json` plus a rendered `stack-trace.md` with original positions and source context previews.
- Add `resolveSourceMaps` and `maxSourceMapBytes` configuration options.

## 0.1.0 - 2026-08-14

- Capture failed tool calls, failed turns, interrupted turns, and live agent errors.
- Export bounded session timelines, deterministic diagnosis, Git evidence, runtime metadata, and the active plugin inventory.
- Redact common credentials, sensitive fields, private keys, URL credentials, and local home paths before writing ZIP archives.
- Distribute as a standard DeepSeek Harness Profile Bundle.
