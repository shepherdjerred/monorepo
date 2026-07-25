---
id: log-2026-06-13-fix-temporal-worker-ffmpeg-static
type: log
status: complete
board: false
---

# Fix: temporal-worker docker build ffmpeg-static resolution failure

## Context

PR #1133 (branch `feature/pr-media-assets`) introduced `discord.js-selfbot-v13`
as a dependency of `packages/toolkit`. This package transitively pulls in
`prism-media`, which attempts `require('ffmpeg-static')` at import time.

`ffmpeg-static` is a native binary shim — it must not be bundled into a
compiled Bun binary. The `packages/toolkit/package.json` build script already
accounts for this with `--external ffmpeg-static`, but the Dagger
`withToolkit` helper in `.dagger/src/image.ts` was calling `bun build` directly
without that flag, causing `docker-build-temporal-worker` to fail with:

```
error: Could not resolve: "ffmpeg-static". Maybe you need to "bun install"?
    at /workspace/packages/toolkit/node_modules/prism-media/src/core/FFmpeg.js:126:36
```

Build 3809, job `019ebe97-cba5-4734-a78d-fb73359b33d8` — exit code 1.

## Fix

Added `"--external", "ffmpeg-static"` to the `bun build` invocation inside
`withToolkit()` in `.dagger/src/image.ts` (line 568–569).

## Session Log — 2026-06-13

### Done

- Read the Buildkite job log for build 3809 via the API
- Identified the exact error: `prism-media` failing to resolve `ffmpeg-static` during `bun build --compile`
- Fixed `.dagger/src/image.ts` `withToolkit()` to add `--external ffmpeg-static`
- All pre-commit hooks passed (dagger-hygiene, quality-ratchet, etc.)
- Committed as `88152ff26` (`fix(dagger): add --external ffmpeg-static to toolkit bun build in withToolkit`)
- Pushed to `origin/feature/pr-media-assets`

### Remaining

- Monitor the next Buildkite build (#3810+) to confirm `docker-build-temporal-worker` goes green

### Caveats

- The `--external` flag was already present in `package.json`'s `build` script, so the local build path was fine — only the Dagger CI path was broken. Keeping the two in sync is a manual discipline.
