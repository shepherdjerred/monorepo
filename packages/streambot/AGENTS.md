# AGENTS.md - streambot

A Discord video-streaming bot, rewritten from first principles. Streams local files and
yt-dlp/URL sources into a Discord voice channel.

## Architecture

One Bun process, two Discord identities, one XState machine as the single source of truth:

- **Command bot** (`discord.js`, bot token) — receives commands, validates input, renders
  status/queue embeds. Translates commands into machine events. ToS-clean control plane.
- **Streamer** (`discord.js-selfbot-v13` + `@shepherdjerred/discord-video-stream`, user token) —
  owns the voice connection + ffmpeg; driven entirely by the machine's invoked actors. The library
  is our in-repo fork of `@dank074/discord-video-stream` (adds a seekable player; see `FORK.md`).
  Live `/stream volume` and `/stream seek` act on the active player as side-channels.
- **Playback machine** (`src/machine/`) — XState v5. Models the lifecycle
  (`idle → joining → resolving → streaming{playing,paused} → leaving`, plus `failed`/retry).
  All I/O lives in invoked actors; the machine itself is pure and unit-tested.

The two-identity split is necessary because Discord bots cannot stream video to voice — only
user accounts can (via the unofficial selfbot lib). Modeled on `packages/discord-plays-pokemon`,
but we stream files/URLs directly with ffmpeg instead of automating a browser.

## Layout

- `src/config/` — Zod config parsed from env at boot (validate at boundary).
- `src/machine/` — XState machine, context/events/actor types.
- `src/sources/` — `source.ts` (Zod discriminated union), `library.ts` (recursive fs scan +
  search), `ytdlp.ts` (system `yt-dlp` via `Bun.spawn`, `--dump-json` → Zod).
- `src/discord/` — command bot client + commands (PR B).
- `src/streamer/` — selfbot + `@dank074` stream driver (PR B).
- `src/observability/` — `metrics.ts` (`prom-client` registry + `Bun.serve` `/metrics`),
  `stream-observer.ts` (maps the fork's `StreamObserver` callbacks → metrics/logs).
- `src/util/` — structured logger, errors.
- `test/` — `bun:test`; the machine is the most heavily tested surface.

## Observability

Prometheus metrics are served at `/metrics` on `METRICS_PORT` (default `9466`, `0` disables),
scraped by a ServiceMonitor (homelab `streambot.ts`). The headline metric is
`streambot_ffmpeg_speed_ratio` — sustained `< 1.0` means the transcode can't keep realtime and
playback will stutter once the buffer drains; read it alongside `streambot_send_frametime_ratio`
(send-bound vs transcode-bound) and `streambot_source_info` (ffprobe codec/resolution/HDR/audio).
Grafana dashboard: `packages/homelab/src/cdk8s/grafana/streambot-dashboard.ts` (uid `streambot`).
The ffmpeg/send signals come from the vendored fork's optional `StreamObserver`
(`@shepherdjerred/discord-video-stream`), threaded via the prepare/play options in `streamer.ts`.

## Conventions

Standard monorepo rules apply: strict TS, no `as` casts, kebab-case files, `.ts` import
extensions, no parent imports (use `@shepherdjerred/streambot/...`), Zod at every boundary,
Bun APIs, structured logging. `yt-dlp` and `ffmpeg` are system binaries baked into the image
(no runtime download).

## Commands

```bash
bun run dev        # watch
bun run test       # unit tests (machine, config, sources)
bun run typecheck
bun run lint
```
