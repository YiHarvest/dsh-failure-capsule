# Changelog

All notable changes to this project are documented in this file.

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
