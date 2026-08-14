# Changelog

All notable changes to this project are documented in this file.

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
