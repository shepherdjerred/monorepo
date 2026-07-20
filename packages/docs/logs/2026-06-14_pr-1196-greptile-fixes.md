---
id: log-2026-06-14-pr-1196-greptile-fixes
type: log
status: complete
board: false
---

# PR #1196 — Greptile P1/P2 fixes (streambot-readrate-backpressure)

## Context

PR #1196 ("fix(streambot): bound ffmpeg input at realtime + encoder-stall obs") was being tended until CI green / no Greptile P3+. Greptile posted two inline comments on commit `88abdeaa5`:

- **P1** (`stream-observer.ts`): Stale timer accumulates across stream restarts — `progressAgeTimer` was started in `onCommand` but never stopped. Each seek or track-change that calls `createStreamObserver` again left a live `setInterval` writing stale timestamps to the shared `ffmpegProgressAgeSeconds` gauge. Past the 5 s stall threshold, this could fire `StreambotProgressStalled` spuriously during normal seeks.
- **P2** (`schema.ts`): JSDoc on `stream.readrate` said "Set to 0 / negative to disable" but the Zod validator used `.positive()`, which rejects those values — contradiction between docs and code.

## Changes Made

### `packages/streambot/src/observability/stream-observer.ts`

- Introduced `StreamObserverHandle` type: `{ observer: StreamObserver; dispose: () => void }`.
- `createStreamObserver` now returns `StreamObserverHandle` instead of `StreamObserver` directly.
- Added `dispose()` function that calls `clearInterval(progressAgeTimer)` and sets `progressAgeTimer = undefined` (idempotent).

### `packages/streambot/src/streamer/streamer.ts`

- Destructures `{ observer, dispose: disposeObserver }` from `createStreamObserver(...)`.
- Calls `disposeObserver()` in the `finally` block at segment end (before the other cleanup steps).

### `packages/streambot/e2e/local.ts`

- Destructures `{ observer: baseObserver, dispose: disposeBase }`.
- Calls `disposeBase()` after `await promise`.

### `packages/streambot/src/config/schema.ts`

- Replaced "Set to 0 / negative to disable (not recommended for pre-recorded sources)" with "Unset the env var (or remove the config key) to disable entirely — `positive()` validation rejects 0 and negative values."

### `packages/streambot/test/stream-observer.test.ts`

- Updated all three existing `createStreamObserver` call sites to destructure the handle.
- Added new test: `dispose stops the progress-age timer so stale segments don't race on the gauge` — verifies idempotent double-dispose is safe.

## Commit

`1176b44f1` — all pre-commit hooks pass (lefthook tier-1 + tier-2 both green).

## Session Log — 2026-06-14

### Done

- Fixed P1 timer stale-accumulation bug: `createStreamObserver` returns `StreamObserverHandle`; `streamer.ts` + `e2e/local.ts` call `dispose()` in finally blocks. (`1176b44f1`)
- Fixed P2 JSDoc contradiction on `stream.readrate` (jsdoc said "set to 0 to disable" but zod rejects 0). (`1176b44f1`)
- Fixed ESLint error in `test/userbot-pool.test.ts`: `readrate: 1.0` → `readrate: 1` (unicorn/no-zero-fractions). (`2a0a7096b`)
- Updated tests; all 7 stream-observer unit tests pass locally.
- Pushed commits to `feature/streambot-readrate-backpressure`.
- Greptile re-review on new HEAD (`09337f817`) returned `pass` — no new P3+ issues.
- BuildKite build #4144 completed with `pass` in 34 minutes.
- All three conditions met: CI green (soft Knip failure ignorable), no merge conflicts, no Greptile P3+.

### Remaining

None — PR is ready for human review.

### Caveats

- 4 integration tests fail locally due to missing macOS Homebrew ffmpeg filters (`zscale`, libass `subtitles`) — pre-existing, unrelated.
- The old Greptile P1/P2 inline comments are still visible on GitHub (they're attached to old commit lines), but the Greptile check itself passes on the new HEAD because those issues are fixed.
