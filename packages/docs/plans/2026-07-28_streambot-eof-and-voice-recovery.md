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

### Remaining

- Complete VAAPI-node and live test-Discord verification.
- Run staged pre-commit checks and Buildkite verification.
- Publish the git-spice pull request with visual evidence.

### Caveats

- The host Homebrew FFmpeg lacks libass/zimg, so its integration run fails at
  filter discovery. The same suite passes in the Streambot runtime image,
  which contains the required filters.
