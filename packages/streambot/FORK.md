# Origin & attribution

This package is a **ground-up rewrite**, not a fork. No source is copied from upstream.

It is **behaviorally inspired** by [`ysdragon/StreamBot`](https://github.com/ysdragon/StreamBot)
(MIT licensed) — specifically its command surface and its use of
[`@dank074/discord-video-stream`](https://github.com/dank074/Discord-video-stream) +
`yt-dlp`/`ffmpeg` to stream video into a Discord voice channel via a user account.

We deliberately diverged:

- **State machine over flag soup.** Upstream tracks playback with mutable booleans
  (`streamStatus.playing`) that invite races; we model the lifecycle as an XState machine.
- **Two-identity split.** A discord.js **bot** handles commands; a separate selfbot streams.
  Modeled on `packages/discord-plays-pokemon` (which streams via a browser — we use ffmpeg).
- **System yt-dlp/ffmpeg.** Baked into the image; no runtime download into a writable dir
  (which broke under our non-root securityContext).
- **No web UI.** Dropped upstream's express/ejs/bcrypt/argon2/session stack; **real Discord slash
  commands** are the control surface — a single `/stream` command with subcommands
  (`/stream play`, `/stream skip`, `/stream queue`, …), accepted in any channel; public status
  posts to a configured channel.
- **Branded types** for ids/tokens (Zod `.brand()`), validate-at-boundary throughout.
- **Intel VAAPI hardware encoding** (with software fallback), and adult-source blocking.

## Streaming library

The streamer drives [`@shepherdjerred/discord-video-stream`](../discord-video-stream) — our in-repo
fork of [`@dank074/discord-video-stream`](https://github.com/dank074/Discord-video-stream) `6.0.0`.
We fork it (rather than depend on npm) so we can add a seekable player and bake in the bun-safe lazy
`sharp` import. See that package's `README.md` for the divergence.

## Playback capabilities & limitations

Upstream `@dank074/discord-video-stream` exposes only `setVolume` and `stopStream` at runtime — no
live seek and no pause. Our fork adds seek:

- `/stream volume` is supported (live). `/stream loop`, `/stream shuffle`, queue editing, and
  skip/stop are all supported (they're machine/queue operations, not stream-transport controls).
- **`/stream seek` is supported (live).** Upstream has no live seek, so the fork's seekable player
  restarts ffmpeg with an input `-ss` offset and re-attaches the demux → stream pipeline onto the
  **same** Go-Live connection — viewers see a seek, not a stream restart. Seek is absolute
  (`/stream seek 1:30`); it acts on the live stream as a side-channel, not a machine event.
- **Pause is still absent** — no clean implementation for a continuous live stream.
- Live streams (yt-dlp `is_live`) play but report no duration; seeking them is not meaningful.

## Caveats

- The streamer uses `discord.js-selfbot-v13`, a self-bot library. Automating a user account is
  against Discord's Terms of Service. This is an accepted, pre-existing risk for this homelab
  service; the selfbot is isolated behind the `src/streamer/` interface so it can be swapped or
  moved to its own process.
