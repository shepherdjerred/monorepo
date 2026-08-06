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
