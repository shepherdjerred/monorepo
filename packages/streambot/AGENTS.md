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

Voice-loss recovery: when Discord kills the userbot's voice session mid-stream (surfaced by the
dvs fork's `close` event and/or the main gateway's voiceStateUpdate), `session/voice-recovery.ts`
classifies the loss by ws close code — a fresh 4014 (moderator disconnect) is respected and stays
down; anything else checkpoints position, preserves the state file through teardown, and retries
`resumeSession` on a delay (bounded by `STREAMER_RECONNECT_MAX_ATTEMPTS`, kill switch
`STREAMER_RECONNECT_ENABLED=false`). Stop reasons are announced to the status channel and counted
in `streambot_voice_disconnects_total` / `streambot_voice_reconnects_total`.

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
  `/stream help` (`helpText()` in `command-handler.ts`) prints the command reference + a
  "supported sources" note; a command-handler test asserts every registered subcommand appears in it.
  `/stream sources [query]` (`sourcesText()` + `listExtractors()` in `sources/ytdlp.ts`, memoized)
  lists/searches the live `yt-dlp --list-extractors` set. `help`/`sources` are session-less
  (`STATELESS_SUBCOMMANDS` in `command-bot.ts`), so they work without anything playing.
- `src/pool/` — userbot pool (login, membership snapshot, acquire/release).
- `src/session/` — per-`(guild, channel)` session manager (actor lifecycle, resume, checkpointing).
- `src/streamer/` — selfbot + `@dank074` stream driver.
- `src/observability/` — `metrics.ts` (`prom-client` registry + `Bun.serve` `/metrics`),
  `stream-observer.ts` (maps the fork's `StreamObserver` callbacks → metrics/logs).
- `src/util/` — structured logger, errors.
- `test/` — `bun:test`; the machine is the most heavily tested surface.
- `integration/` — real-ffmpeg integration tests (`bun run test:integration`); need real
  ffmpeg/ffprobe (e.g. inside the streambot image), never part of the plain `bun test`. They
  are not wired into a turbo task, so `bun run verify` and CI don't run them — run them
  manually against real ffmpeg when touching the ffmpeg pipeline.

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
  auto-captions (`SUBTITLES_INCLUDE_AUTO_GENERATED`). YouTube **auto-generated** captions use a
  "rolling" format (each phrase emitted several times — built up word-by-word, a ~10 ms finalization
  cue, then carried as the top line while the next builds), which libass would burn as a doubled,
  stale, sometimes-reversed two-line scroll. `cleanRollingSrt` (`sources/subtitle-clean.ts`) detects
  that signature on the staged `.srt` and collapses it to clean, one-line-at-a-time cues; clean tracks
  (manual captions, sidecars) are left untouched.

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

## discord-video-stream / VAAPI pipeline

`@shepherdjerred/discord-video-stream` lives at `packages/discord-video-stream`, consumed via `file:` → TS source. VAAPI gotchas baked into its design:

- **Software-scale trap:** `prepareStream` historically emitted `-hwaccel auto` (decode → system RAM) + software `scale=` (swscale) with only the encode on the GPU; on 4K HEVC that swscale runs ~0.77× realtime → CFS throttling on the 2-core limit → `Frame takes too long to send` stutter. `EncoderSettings.hwPipeline` keeps the whole graph on the GPU (`-hwaccel vaapi -hwaccel_output_format vaapi` + `scale_vaapi=…:format=nv12`) for ~22× less CPU.
- `h264_vaapi` defaults to **AVBR** (ignores `-maxrate`/`-bufsize`, uncapped bitrate) — pin `-rc_mode VBR`. Drop `-pix_fmt yuv420p` + `hwupload` on the hw path.
- Node `torvalds` advertises 10 `gpu.intel.com/i915` slots (iHD driver); spin a temp pod to benchmark ffmpeg against the real media (RWO PVCs mount on multiple same-node pods).

## Live e2e (`bun run e2e`)

Runs against a dedicated **test** Discord server (never the production `streambot-config` guild). IDs are passed as env vars so prod config is untouched; tokens come from the `streambot-config` 1P item (Homelab vault). The selfbot logs in as `glidiot_`. (This live Discord e2e is not part of the Buildkite pipeline — it needs a real test guild and user tokens — so run `e2e/run.ts` directly.) It needs `USER_TOKENS` plus the test-only `E2E_GUILD_ID`/`E2E_VIDEO_CHANNEL_ID` envs (production joins the issuer's current VC, which a headless test can't set), and real ffmpeg/ffprobe on PATH.

```bash
J=$(op item get streambot-config --vault "Homelab (Kubernetes)" --format json --reveal)
export BOT_TOKEN=$(echo "$J" | jq -r '.fields[]|select((.label//.id)=="BOT_TOKEN").value')
export USER_TOKENS=$(echo "$J" | jq -r '.fields[]|select((.label//.id)=="TOKEN").value')
E2E_GUILD_ID=1337623164146155593 E2E_VIDEO_CHANNEL_ID=1337623164955398253 bun run e2e
```

The homelab deployment sources `USER_TOKENS` (comma-separated pool) from that 1P item.

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
(no runtime download). When building the image, install `yt-dlp` by downloading the per-arch
standalone binary from the release **asset CDN**
(`github.com/yt-dlp/yt-dlp/releases/latest/download/<asset>`) and verifying it against
`SHA2-256SUMS` (this install runs as a step in the `Dockerfile`). Do **not** rely on `youtube-dl-exec`'s postinstall — it queries `api.github.com`
unauthenticated (its token header is silently dropped by a `fetch(url, headers)` vs
`fetch(url, { headers })` bug) and exhausts GitHub's 60 req/hr anonymous limit on shared egress
IPs, intermittently failing image builds.

## Commands

```bash
bun run dev              # watch
bun run test             # unit tests (machine, config, sources) — test/, no ffmpeg
bun run test:integration # real-ffmpeg subtitle tests — integration/, needs ffmpeg+libass
bun run typecheck
bun run lint
```

**Fresh-worktree typecheck gotcha:** `bun run typecheck` can fail with ~40 errors from
`../discord-video-stream/src/*`. Cause: `bun run build` in `packages/discord-video-stream`
produces the package's d.ts into its `dist/`, but the **copied** workspace entries under
`node_modules/@shepherdjerred/discord-video-stream/` have no `dist/`, so tsc's `exports` `types`
condition fails and it type-checks the loose package source instead. Fix (gitignored, local-only):

```bash
for d in node_modules packages/streambot/node_modules; do
  mkdir -p "$d/@shepherdjerred/discord-video-stream/dist"
  cp -R packages/discord-video-stream/dist/. "$d/@shepherdjerred/discord-video-stream/dist/"
done
```

(The image build does the same copy, so CI never hits this; apply the fix manually in fresh local checkouts.)
