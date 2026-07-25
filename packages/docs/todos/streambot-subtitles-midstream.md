---
id: streambot-subtitles-midstream
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Streambot: toggle subtitles on/off mid-stream

## What

Subtitles can only be chosen at play-time and re-applied on seek; there's no way
to turn them on/off while a stream is running. Add a live toggle.

- Set today via `/stream play subtitles:on sublang:en` (and `/stream playnext`)
  in `packages/streambot/src/discord/commands.ts`.
- The chosen subtitle is staged to a temp file and burned into the ffmpeg
  pipeline once at segment start (`packages/streambot/src/streamer/streamer.ts`
  ~213–241), then re-staged on `/stream seek` via a PTS-compensation sandwich.
- Pipeline: `packages/discord-video-stream/src/media/videoGraph.ts`
  (`subtitle` option); ranking in `packages/streambot/src/sources/subtitles.ts`,
  staging in `subtitle-io.ts`.

## Why it's deferred (architecturally hard)

Subtitle burn is baked into the ffmpeg encode at segment start, and Discord
Go-Live is a single video track with no live re-invoke / pause-resume. A true
toggle requires re-staging subtitles and restarting the encode mid-playback —
likely by seamlessly restarting the current segment at the current position (or
dropping and rejoining the Go-Live session, which disrupts playback).

## Remaining

- [ ] A `/stream subtitles on|off` command toggles subtitle burn during playback
      with minimal disruption (ideally a seamless segment restart at the current
      offset), without requiring the user to re-issue `/stream play`.
