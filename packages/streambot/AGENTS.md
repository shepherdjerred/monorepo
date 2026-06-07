# AGENTS.md - streambot

A Discord video-streaming bot, rewritten from first principles. Streams local files and
yt-dlp/URL sources into a Discord voice channel.

## Architecture

One Bun process, two Discord identities, one XState machine as the single source of truth:

- **Command bot** (`discord.js`, bot token) — receives commands, validates input, renders
  status/queue embeds. Translates commands into machine events. ToS-clean control plane.
- **Streamer** (`discord.js-selfbot-v13` + `@dank074/discord-video-stream`, user token) —
  owns the voice connection + ffmpeg; driven entirely by the machine's invoked actors.
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
- `src/util/` — structured logger, errors.
- `test/` — `bun:test`; the machine is the most heavily tested surface.

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
