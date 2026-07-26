---
id: 2026-07-25-streambot-1667-codex-followup
type: log
status: complete
board: false
---

# Streambot: address Codex P1/P2 crash-recovery findings from PR #1667

PR #1667 ("fix(streambot): truthful playback outcomes + bounded HW-first crash
recovery") merged to `main` with eight Codex review findings (5×P1, 3×P2) left
unaddressed. This follow-up PR fixes all eight against current `main`. Each fix
was verified against the live tree first (line numbers had shifted from the
merged diff).

## Findings and fixes

### P1

1. **`packages/discord-video-stream/src/media/LibavDemuxer.ts` — destroy only
   pipes with error consumers.** `attachPipeline` installs an `error` listener
   only on the _returned_ streams (newApi.ts: `video.stream` / `audio?.stream`).
   When ffmpeg emits video without audio (`includeAudio:false` or a video-only
   source), `aInfo` is absent, `aPipe` is never returned, and destroying it WITH
   an error emitted an unhandled `error` that can terminate the process. Fix:
   the demux-error branch of `cleanup` now destroys WITH the error only pipes
   that have their info present (are returned/consumed); unconsumed pipes are
   destroyed without an error.

2. **`packages/streambot/src/observability/stream-observer.ts` — advance the
   watchdog only when media time advances.** `onProgress` unconditionally
   refreshed `lastProgressWallMs` and cleared `stallFired` every report, so a
   wedged ffmpeg re-emitting the SAME timemark reset the progress-age each tick
   and the 20s stall never fired. Fix: only re-arm the watchdog when the parsed
   media timemark strictly advances (first parseable sample counts as an
   advance).

3. **`packages/streambot/src/streamer/streamer.ts` — resume a stalled segment
   from producer time.** `getPosition()` keeps advancing from wall-clock through
   the stall, so routing it into `PRODUCER_STALLED` sent an inflated position
   (~20s ahead). Fix: the observer now passes the stale interval (`ageSeconds`)
   to `onStall`; the streamer resumes at `producerResumeSeconds(getPosition(),
staleSeconds, startSeconds)` — the last delivered media position, floored at
   the segment start. New pure helper `producerResumeSeconds` in
   `stream-errors.ts`.

4. **`packages/streambot/src/machine/playback-helpers.ts` — clear recovery state
   when a retry fails to resolve.** A crashed item's recovery re-enters
   `resolving` carrying `resumeSeekSeconds` + `crashRetries`. If that re-resolve
   rejected, `resolveErrorUpdates` left both intact, so the next dequeued item
   started at the previous item's crash offset and inherited its escalated
   pipeline (hw-upload/sw). Fix: `resolveErrorUpdates` now clears
   `resumeSeekSeconds` and `crashRetries` (the `streaming`-state `consumeSeek` /
   `resetCrashRetries` never runs when a resolve fails before streaming).

5. **`packages/docs/logs/2026-07-25_streambot-spiderman3-ffmpeg-exit-218.md` —
   update the diagnosis log.** The log still listed the crash-detection/recovery
   ladder as unimplemented. Moved it to `### Done`, trimmed `### Remaining` to
   the optional upstream ffmpeg report + a live re-verification, and appended a
   Comment Log entry superseding the "still unimplemented" note.

### P2

6. **`packages/discord-video-stream/src/media/player.ts` — abort ffmpeg when its
   settle timeout expires.** A drained-but-wedged ffmpeg was treated as a natural
   end (`succeed()`), tearing down the Discord connection while leaving ffmpeg
   and its pending promise alive (an orphan running alongside a retry/next item).
   Fix: on `outcome.kind === "timeout"`, abort the controller and `fail()` with a
   timeout error so the outcome is classified, not reported as clean EOF.

7. **`packages/discord-video-stream/src/media/player.ts` +
   `packages/streambot/src/streamer/streamer.ts` — keep graph-init failures on
   the startup fallback.** `createSeekablePlayer.start()` resolved even when the
   initial `attachPipeline` failed (runSegment swallowed it into `finished`), so
   the streamer set `playbackStarted = true` and later classified the
   VAAPI-graph-init failure as a mid-stream `StreamCrashError` — bypassing the
   immediate software fallback for the slower recovery ladder. Fix: the initial
   `runSegment` (`initial: true`) now rejects `start()` on attach failure (and
   aborts the paired ffmpeg so its promise.catch is silenced). The streamer's
   existing catch then routes it as a startup failure → immediate sw fallback; a
   no-op consumer on `player.finished` prevents an unhandled rejection in the
   ffmpeg-rejects-first race.

8. **`packages/streambot/src/streamer/streamer.ts` — record stall recoveries in
   crash metrics.** The `stall` kind on `streamCrashesTotal` was advertised but
   never incremented (aborting the actor left the segment outcome at "ended", so
   real stalls looked like successful segments). Fix: the streamer's `onStall`
   now increments `streamCrashesTotal{pipeline, kind:"stall"}` at detection,
   symmetric with the crash/ended-short increments.

## Tests added / changed

- `packages/discord-video-stream/test/player.test.ts`: harness now captures the
  prepare abort signals and supports `attachErrors`; the settle-timeout test now
  asserts `finished` rejects + ffmpeg aborted (#6); new test that an initial
  attach failure rejects `start()` (#7).
- `packages/streambot/test/stream-observer.test.ts`: new stall-watchdog suite —
  wedged same-timemark still trips the watchdog with the correct `staleSeconds`
  (#2/#3), advancing media stays armed (no false stall), fires once per silence.
  `createStreamObserver` gained an injectable `progressTickMs` (default 1000)
  for deterministic tests.
- `packages/streambot/test/streamer-position.test.ts`: `producerResumeSeconds`
  unit tests (#3 math — backs out the stale interval, floors at start offset).
- `packages/streambot/test/playback-machine.test.ts`: new "crash recovery —
  state cleanup" test proving a rejected recovery re-resolve drops the item and
  the next item starts clean (seek 0, pipeline hw) (#4).

## Verification

Scoped (compute-safe — never repo-wide):

```
bunx turbo run typecheck test lint \
  --filter=@shepherdjerred/discord-video-stream --filter=@shepherdjerred/streambot
```

All green: typecheck + test + lint pass for both packages. Player suite 14 pass,
stream-observer 10 pass; the stall tests log `ffmpeg progress stalled`
`ageSeconds` 21 / 29 as expected.

## Session Log — 2026-07-25

### Done

- All 8 Codex findings (5×P1, 3×P2) fixed against current `main` in worktree
  `pr-1667fu-streambot-recovery` (branch `feature/streambot-crash-recovery-fixes`).
- Files changed: `LibavDemuxer.ts`, `player.ts`, `stream-observer.ts`,
  `streamer.ts`, `stream-errors.ts`, `playback-helpers.ts`, the
  spiderman3 diagnosis log, and four test files (see above).
- Scoped typecheck/test/lint green for both packages.

### Remaining

- Drive the new PR's Buildkite checks to green and resolve any Codex review
  threads it opens.

### Caveats

- `#6` is a deliberate behavior change: a drained-but-wedged ffmpeg is now a
  failure (classified → retry), not a silent natural end. The player test that
  asserted the old "resolves finished after timeout" behavior was updated to the
  new contract.
- `#8` increments the stall counter at detection in the streamer's `onStall`
  (has the `pipeline` label, symmetric with crash counting). Direct unit
  coverage of that single line isn't practical without the real observer timer;
  the trigger (`onStall` firing with `staleSeconds`) is covered by the observer
  suite.
