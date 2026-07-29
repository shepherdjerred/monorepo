---
id: 2026-07-28-streambot-recent-stalls
type: log
status: complete
board: false
---

# Streambot recent stalls

## Question

Why has Glidiot Helper recently lost its voice connection and repeatedly
stalled while playing `House of the Dragon - S03E05 - Unbowed and Unbent`?

## Investigation

- The Discord transcript shows a recoverable voice connection loss at 23:22
  PDT, followed by playback watchdog stalls at 00:10 and 00:57 PDT.
- The affected pod was `media-streambot-54479f8c57-p2bj2`. It did not restart
  during the incident.

## Findings

There were two separate behaviors.

### Discord voice disconnect

At `2026-07-27T06:22:54.272Z`, the Discord voice WebSocket closed with code
`4014` and `canResume: false`. The command-bot gateway reported the streamer's
voice state becoming null 98 ms later. That gateway event won a race with the
fork's close-code handoff, so recovery logged the less-specific
`voice connection lost (no close code observed)`. The session rejoined after
five seconds and was confirmed healthy 30 seconds later, resuming from 16:25.

The `4014` record proves a Discord-side voice-session detach, but the available
telemetry cannot distinguish a moderator move/disconnect from another
Discord-side invalidation.

### False stalls at natural end-of-file

The later warnings were not mid-episode transcode failures:

1. The resumed hardware stream advanced from 16:25 to the episode's exact
   1:03:24.301 duration.
2. Its ffmpeg media clock then stopped at segment-relative `2819.33` seconds.
   The watchdog fired 20.879 seconds later and converted the natural end into a
   stall retry at absolute 1:03:24.
3. The retry started ffmpeg at `-ss 3804`, effectively EOF, and produced only
   0.33 seconds before wedging. The watchdog fired again.
4. A startup race left `segmentStartOffsetSeconds` at the previous 16:25
   offset, so that second retry was calculated as `985 + 0.33` and restarted
   the episode at 16:25 instead of EOF.
5. The replayed remainder reached EOF again 47 minutes later and triggered the
   third warning. The software fallback started at EOF and exited immediately.

The underlying EOF wedge is in
`packages/discord-video-stream/src/media/videoGraph.ts`. The VAAPI subtitle
graph creates a transparent `color` source without a duration and composes it
using bare `overlay_vaapi`. In the deployed ffmpeg:

- `color` defaults to an infinite duration.
- `overlay_vaapi` defaults to `shortest=false`.

The subtitle branch therefore outlives the real video at EOF, preventing the
hardware pipeline from completing. The watchdog added by PR #1667 makes the
latent EOF hang visible as a "stall".

This is systemic, not specific to the House of the Dragon file. The only six
stall detections from July 26 through the investigation time are two identical
three-warning sequences:

- `House of the Dragon - S03E05`: exact 1:03:24 EOF, EOF retry, replay from
  16:25, exact EOF again.
- `Walker, Texas Ranger - S05E05`: exact 44:24 EOF, EOF retry, replay from
  0:00, exact EOF again.

Both sources used burned subtitles and the VAAPI overlay graph. No recent
watchdog event represents a genuine mid-stream ffmpeg throughput stall.

## Current state

- The current production pod is ready with zero restarts and low idle resource
  use (`16m` CPU, `155 MiB` memory at inspection time).
- No Streambot Grafana alert was firing.
- Bugsink has no Streambot issue newer than July 25; this failure is a
  non-throwing lifecycle bug and does not reach error tracking.

## Workflow Friction

- The `monorepo-docs` skill instructs agents to run both `bun run check-docs`
  and `bun run check-todos`, but the root has no `check-docs` script.
  `bun run check-todos` already invokes
  `packages/docs-board/src/cli/check-docs.ts` and validates the full Markdown
  model. Update `/Users/jerred/.agents/skills/monorepo-docs/SKILL.md` to name
  only the command that exists.

## Session Log — 2026-07-28

### Done

- Correlated the Discord transcript with production Loki records from
  `2026-07-27T06:00:00Z` through `08:10:00Z`.
- Identified the separate Discord `4014` detach and successful reconnect.
- Root-caused the repeated warnings to the infinite VAAPI subtitle canvas at
  natural EOF, plus a stale segment-offset race during recovery.
- Checked the full recent stall history and confirmed the same sequence on a
  second media file.
- Confirmed the current pod is healthy and the incident did not involve a pod
  restart or a Bugsink exception.

### Remaining

- Implement and test finite EOF behavior for the VAAPI subtitle graph, likely
  by making the overlay terminate with the primary video.
- Anchor the segment start offset before ffmpeg startup so a startup-time stall
  cannot reuse the preceding segment's offset.
- Preserve the observed close code when command-gateway and voice-WebSocket
  disconnect signals race, so `4014` is classified consistently.

### Caveats

- Code and deployment were not changed because the user asked for diagnosis.
- The telemetry identifies Discord close code `4014`, but not which external
  actor or Discord condition initiated the detach.
