# AGENTS.md - streambot

A Discord video-streaming bot, rewritten from first principles. Streams local files and
yt-dlp/URL sources into a Discord voice channel.

## Architecture

One Bun process serving **many servers** — and **many voice channels per server** — with a single
command bot plus a **pool of streamer userbots**:

- **Command bot** (`discord.js`, bot token) — one identity, registers **global** slash commands and
  routes each interaction (by `interaction.guildId` + the issuer's current voice channel) to the
  right session. Renders status/queue embeds. ToS-clean control plane (`src/discord/command-bot.ts`).
- **Userbot pool** (`src/pool/userbot-pool.ts`) — N `discord.js-selfbot-v13` accounts
  (`USER_TOKENS`, comma-separated). Each logs in at boot and snapshots its guild membership from
  `client.guilds.cache`. A play **acquires** a free userbot that is a member of the requesting guild;
  when none is free the bot replies "No stream bots are available right now." One userbot streams in
  at most one voice channel at a time, so the pool size bounds concurrent streams.
- **Session manager** (`src/session/session-manager.ts`) — one playback session per
  `(guild, voice channel)`, each an isolated XState actor bound to the acquired userbot's streamer.
  Sessions are independent (separate queues/loop/volume) and release their userbot when the channel
  goes idle. The bot joins the **issuer's current voice channel**; status posts to the channel the
  command was invoked in.
- **Streamer** (`src/streamer/streamer.ts`, `@shepherdjerred/discord-video-stream`) — owns one
  selfbot's voice connection + ffmpeg, driven by the machine's invoked actors. The library is our
  in-repo fork of `@dank074/discord-video-stream` (seekable player; see `FORK.md`). Live
  `/stream volume` and `/stream seek` act on the active player as side-channels.
- **Playback machine** (`src/machine/`) — XState v5. Models the lifecycle
  (`idle → joining → resolving → streaming → … → waiting → leaving`, plus `failed`/retry). All I/O
  lives in invoked actors; the machine itself is pure and unit-tested. One actor per active session.

Resume: per-`(guild, channel)` state files `playback-state-<guildId>-<channelId>.json` (schema v2).
On restart the session manager re-acquires a member-userbot per persisted session and resumes it.

The bot/userbot split is necessary because Discord bots cannot stream video to voice — only user
accounts can (via the unofficial selfbot lib). Modeled on `packages/discord-plays-pokemon`, but we
stream files/URLs directly with ffmpeg instead of automating a browser.

## Layout

- `src/config/` — Zod config parsed from env at boot (validate at boundary).
- `src/machine/` — XState machine, context/events/actor types.
- `src/sources/` — `source.ts` (Zod discriminated union), `library.ts` (recursive fs scan +
  search), `ytdlp.ts` (system `yt-dlp` via `Bun.spawn`, `--dump-json` → Zod), `normalize.ts`
  (clean release-junk filenames → `Title (Year)`, used for display + matching), `chapters.ts`
  (chapter markers: `ffprobe` for files, yt-dlp `chapters` for URLs; best-effort, never throws),
  `subtitles.ts` (pure subtitle helpers), `subtitle-io.ts` (ffprobe/ffmpeg/yt-dlp glue that stages
  a track).
- `src/metadata/` — `tmdb.ts`: optional TMDB poster lookup for the now-playing embed (local files).
  Best-effort + in-process cache; disabled unless `TMDB_API_KEY` is set.
- `src/discord/` — command bot client + commands + routing. `status-reporter.ts` posts the
  now-playing line (with a TMDB poster embed for local files when configured). `/stream chapters`
  lists chapters; `/stream chapter <n>` seeks to one (reuses the live seek side-channel).
- `src/pool/` — userbot pool (login, membership snapshot, acquire/release).
- `src/session/` — per-`(guild, channel)` session manager (actor lifecycle, resume, checkpointing).
- `src/streamer/` — selfbot + `@dank074` stream driver.
- `src/observability/` — `metrics.ts` (`prom-client` registry + `Bun.serve` `/metrics`),
  `stream-observer.ts` (maps the fork's `StreamObserver` callbacks → metrics/logs).
- `src/util/` — structured logger, errors.
- `test/` — `bun:test`; the machine is the most heavily tested surface.
- `integration/` — real-ffmpeg integration tests (`bun run test:integration`); run only in the
  streambot image (via the `smoke-test-streambot` Dagger fn), never in the plain `bun test`.

## Subtitles

Discord Go-Live is a single video track, so subtitles are **burned in** with ffmpeg's `subtitles=`
(libass) filter. On by default (`SUBTITLES_ENABLED`), with per-request overrides on `/stream play` /
`/stream playnext`: `subtitles:on|off` and `sublang:<lang>` (e.g. `en`, `es`, or `en.forced` to pin a
modifier). For local files, **sidecar and embedded text tracks compete in ONE cross-source ranking**:
language preference (tags canonicalized so `en`/`eng`/`en-US` are one language) → modifier quality
(full > hi/sdh/cc > forced) → source (sidecar preferred only as a tie-break). A forced-only sidecar
therefore never shadows a full embedded track. Candidate sources:

- **Local sidecar**: a sibling `<videobase>.<lang>[.forced|.hi|.sdh|.cc].{srt,ass,ssa,vtt}`
  (Plex/Bazarr naming).
- **Local embedded**: an embedded **text** track (subrip/ass/mov_text/…), extracted via ffmpeg;
  modifiers come from dispositions (`forced`, `hearing_impaired`) and `SDH`/`FORCED` title tags. Image
  subs (PGS/VobSub/DVB — common on Blu-ray Remux) can't be burned and are skipped.
- **yt-dlp** (non-local sources): downloads the preferred subtitle track, falling back to
  auto-captions (`SUBTITLES_INCLUDE_AUTO_GENERATED`).

Every track is staged to a safe temp file (`$TMPDIR/streambot-subs/<uuid>.<ext>`) so the filter never
references a user path with spaces/quotes; `runStream` unlinks it when the track ends, and startup
sweeps orphans. **Burning no longer forces software encoding**: on the VAAPI pipeline the fork renders
subtitles with libass onto a transparent BGRA canvas, `hwupload`s it, and composites with
`overlay_vaapi`, so decode/scale/tonemap/encode all stay on the GPU. Subtitles survive `/stream seek`
and the HW→SW retry because the seekable player re-applies the burn on every ffmpeg restart, and the
graph PTS-compensates the `subtitles=` filter for the `-ss` offset (cues stay correct after seeks).
Config: `SUBTITLES_ENABLED`, `SUBTITLE_LANGUAGES`, `SUBTITLES_INCLUDE_AUTO_GENERATED`, `FFPROBE_PATH`.

## HDR

`resolveSource` ffprobes every input; PQ/HLG (`smpte2084`/`arib-std-b67`) sets `ResolvedSource.hdr`,
which `streamer.ts` passes to the fork as `inputColor: "hdr"`. The pipeline then tonemaps to BT.709
SDR — `scale_vaapi=format=p010,tonemap_vaapi` on the GPU path, a zimg/Hable `zscale`+`tonemap` chain
on the software path — so HDR remuxes no longer look washed out. If the iGPU lacks the HDR VPP
(`tonemap_vaapi`) or `overlay_vaapi`, ffmpeg fails at graph init and the existing HW→SW retry
resumes playback on the software chain (watch `streambot_hw_fallback_total`).

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
bun run dev              # watch
bun run test             # unit tests (machine, config, sources) — test/, no ffmpeg
bun run test:integration # real-ffmpeg subtitle tests — integration/, needs ffmpeg+libass
bun run typecheck
bun run lint
```
