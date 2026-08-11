# streambot

Discord video-streaming orchestrator: streams local media files and yt-dlp/URL
sources into Discord voice channels, controlled entirely through a `/stream`
slash command (`/stream play`, `skip`, `queue`, `seek`, `volume`, `chapters`,
`help`, `sources`, …). One Bun process serves many servers — and many voice
channels per server — concurrently.

## How it works

Discord bots cannot stream video into voice; only user accounts can. Streambot
therefore splits identities:

- **Command bot** (`discord.js`, bot token) — the ToS-clean control plane:
  registers global slash commands, routes each interaction to the right
  session, renders the status/queue player card.
- **Userbot pool** (`discord.js-selfbot-v13`, `USER_TOKENS`) — N streaming
  accounts. A play acquires a free userbot that is a member of the requesting
  guild; pool size bounds concurrent streams.
- **Sessions** — one playback session per `(guild, voice channel)`, each an
  isolated XState v5 actor with its own queue/loop/volume. Playback state is
  persisted per session and resumed across restarts, including voice-loss
  recovery with close-code classification.
- **Streamer** — ffmpeg-driven voice streaming via
  [`@shepherdjerred/discord-video-stream`](../discord-video-stream/), the
  in-repo fork of `@dank074/discord-video-stream` (seekable player, VAAPI
  hardware-encode pipeline, stream observer for metrics).

The playback lifecycle is a pure, unit-tested XState machine; all I/O lives in
invoked actors. `yt-dlp` and `ffmpeg` are system binaries baked into the
Docker image. Prometheus metrics are served on `/metrics` (default port 9466);
the headline signal is `streambot_ffmpeg_speed_ratio`.

This package is a ground-up rewrite behaviorally inspired by
`ysdragon/StreamBot` — no upstream source is copied. [FORK.md](FORK.md)
documents the attribution and the deliberate divergences (state machine over
mutable flags, bot/userbot split, no web UI, branded types, VAAPI encoding).

## Commands

```bash
bun run dev              # watch mode
bun run start            # run once
bun run test             # unit tests (machine, config, sources) — no ffmpeg needed
bun run test:integration # real-ffmpeg subtitle tests (needs ffmpeg + libass)
bun run e2e              # live e2e against the dedicated test Discord server
bun run e2e:voice-recovery # live voice-loss recovery e2e
bun run typecheck
bun run lint
bun run docker:build     # build the image (repo-root build context)
bun run smoke            # smoke script
```

The live e2e runs need real tokens and test-guild IDs via env — see
[AGENTS.md](AGENTS.md), which also covers the architecture in depth, the
player card, subtitles, HDR, the VAAPI pipeline, observability, and known
gotchas (fresh-worktree typecheck, yt-dlp install in the Dockerfile).
