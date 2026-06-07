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

## Playback limitations (library)

`@dank074/discord-video-stream` exposes only `setVolume` and `stopStream` at runtime — there is
**no seek and no pause**. So:

- `/stream volume` is supported (live). `/stream loop`, `/stream shuffle`, queue editing, and
  skip/stop are all supported (they're machine/queue operations, not stream-transport controls).
- **Seek / pause are intentionally absent.** Seek would require stop → restart-with-`-ss`-offset
  (a future enhancement); pause has no clean implementation for a continuous live stream.
- Live streams (yt-dlp `is_live`) play but report no duration.

## Caveats

- The streamer uses `discord.js-selfbot-v13`, a self-bot library. Automating a user account is
  against Discord's Terms of Service. This is an accepted, pre-existing risk for this homelab
  service; the selfbot is isolated behind the `src/streamer/` interface so it can be swapped or
  moved to its own process.
