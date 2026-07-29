---
id: 2026-07-28-streambot-eof-and-voice-recovery
type: plan
status: in-progress
board: false
---

# Streambot EOF stalls and Discord recovery

## Summary

Fix three connected failure modes:

- Subtitled VAAPI streams hanging at natural EOF.
- Retry attempts resuming from a stale playback position.
- Discord Go-Live `4014` closures being misclassified as code-less transient
  disconnects.

A deliberate `4014` continues to keep Streambot offline; other transport
losses continue to reconnect.

## Implementation

- Make the VAAPI subtitle overlay terminate with the underlying video by using
  `overlay_vaapi=shortest=1`.
- Anchor each playback attempt before starting its observer/player. Keep the
  public clock stopped until startup succeeds, and roll back live-seek anchors
  if seeking fails.
- Relay Go-Live `StreamConnection` close events through `VoiceConnection` and
  detach listeners when the child connection changes.
- Keep transport-close observation active through teardown so a late `4014`
  can reclassify a pending reconnect. Within one session, deliberate closure
  information takes precedence over transient closure information.
- Add deterministic unit and real-ffmpeg regression coverage for each failure.

## Verification

- Run focused build, typecheck, test, and lint tasks for
  `@shepherdjerred/discord-video-stream` and `@shepherdjerred/streambot`.
- Run Streambot's real-ffmpeg integration suite and local E2E suite.
- Prove the corrected graph exits at EOF with a bounded fixture on a
  VAAPI-capable node.
- Verify natural EOF and deliberate `4014` behavior in the test Discord server.
- Run the staged pre-commit checks and use Buildkite as the exhaustive CI gate.
- Attach before/after Discord evidence to the pull request.

## Session Log — 2026-07-28

### Done

- Created the isolated `fix/streambot-eof-voice-recovery` worktree.
- Moved the diagnosis log into the worktree and initialized the toolchain,
  dependencies, generated artifacts, and hooks.
- Added `shortest=1` to the VAAPI subtitle overlay and a bounded real-ffmpeg
  EOF regression.
- Anchored segment starts before observer/player startup and added live-seek
  rollback coverage.
- Relayed Go-Live close events through `VoiceConnection`, preserved late close
  observation through teardown, and covered gateway-first late `4014`
  classification.
- Passed the fork build, typecheck, and 61 unit tests; Streambot typecheck,
  lint, 388 unit tests, and local E2E; and all 14 real-ffmpeg integration tests
  inside the built runtime image.
- Proved the VAAPI EOF fix on `torvalds`: the old graph hit the eight-second
  watchdog (`124`) while `overlay_vaapi=shortest=1` exited successfully (`0`);
  removed the temporary GPU pod afterward.
- Added `e2e:voice-recovery` and proved a real subtitled stream in the dedicated
  Discord guild reaches natural EOF and advances to `waiting` without a stall
  retry.
- Passed the staged pre-commit checks, opened draft PR #1778, and attached the
  supplied failure screenshot plus the available verification evidence.
- Traced Buildkite #6775 to the new live harness's optional-chain lint finding,
  corrected it, and re-ran Streambot lint, typecheck, and 44 focused regression
  tests successfully.
- Addressed the review gate's teardown-race finding by retaining the stopped
  Go-Live child's close relay until replacement and allowing a racing `4014`
  through local-stop suppression exactly once; the fork's build, typecheck, and
  tests plus Streambot's affected checks pass.
- Addressed the review gate's seek-failure finding by making replacement attach
  failures reject both `seek()` and active playback, tear down their resources,
  freeze public position until attach succeeds, and leave the clock stopped if
  playback exits first. Added generation ownership so a superseded overlapping
  seek cannot commit or clear the newer seek's anchor. Assigned the privileged
  live-permission TODO to operator verification. The fork passes all 63 tests,
  and Streambot's 26 affected regression tests pass.

### Remaining

- Provision a test-guild identity with **Move Members**, then complete the live
  `4014` phase tracked by
  `packages/docs/todos/streambot-live-4014-e2e-permission.md`.
- Keep the current PR head green in Buildkite and complete review/merge for
  PR #1778.

### Caveats

- The host Homebrew FFmpeg lacks libass/zimg, so its integration run fails at
  filter discovery. The same suite passes in the Streambot runtime image,
  which contains the required filters.
- The command bot and default test user both receive Discord error `50013`
  (Missing Permissions) when attempting a moderator disconnect. The live
  `4014` check therefore remains permission-blocked; direct and gateway-first
  late `4014` paths are covered by deterministic tests.
