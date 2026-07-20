---
id: log-2026-06-13-streambot-startup-latency
type: log
status: complete
board: false
---

# Streambot startup latency — 30s–1m to start playing

## Problem

User played a movie via streambot and asked why it takes 30s–1m before playback starts.

## Diagnosis

Pod `media-streambot-*` (namespace `media`). Logs from a real play (Avengers: Endgame,
2026-06-13 23:31–23:32), timed per stage:

| Stage                                 | Time       |
| ------------------------------------- | ---------- |
| joined voice → **subtitle extracted** | **49.6 s** |
| subtitle → source probed              | 0.4 s      |
| probed → ffmpeg spawned               | 0.6 s      |
| ffmpeg → first frames                 | 0.8 s      |
| **total join → playback**             | **51.4 s** |

**Root cause:** burned-in subtitles need a `.srt` on disk before ffmpeg starts.
`resolveSource` (`sources/resolve.ts:77`) awaits `resolveSubtitleForFile` →
`extractEmbeddedTrack` (`sources/subtitle-io.ts`) on the critical path, which runs
`ffmpeg -i <file> -map 0:s:0 -c:s srt <tmp>`. Subtitle packets are interleaved across the
whole timeline, so ffmpeg must **demux the entire container** to collect them. Verified
in-pod: extraction walked all `2:48:05` at ~180× realtime ≈ **56 s** to emit a **145 KB**
SRT, off a 61 GB remux on `zfspv-pool-hdd` (ZFS on spinning HDDs). No caching existed
(random-UUID temp, wiped at startup) so every play re-paid it. The 30s–1m range scales with
runtime + ZFS ARC warmth; sidecar-subtitle titles already start fast.

## Fix (this PR)

Two changes, addressing the wait itself and the UX during it.

### 1. Persistent embedded-subtitle cache (`packages/streambot`)

- `sources/subtitle-io.ts` — `extractEmbeddedTrack` now caches into `config.subtitles.cacheDir`
  when set. Key = SHA-256 of `path\0size\0mtime\0s<index>` (`embeddedCacheKey`) — a **cheap,
  content-free** key (one `stat`, not a hash of the tens-of-GB file), invalidated on
  replace/re-encode exactly like Plex/Jellyfin. Extraction writes a sibling `.tmp` then
  atomically `rename`s into place; cache hits return `{ path }` with **no `cleanupPath`**.
  Falls back to the old swept-temp behaviour when no cache dir / unwritable / unstattable.
- `machine/types.ts` — `ResolvedSubtitle.cleanupPath` is now optional; a cache entry is shared
  and must survive. `streamer/streamer.ts` skips unlinking when it's absent.
- `config/schema.ts` + `config/index.ts` — new optional `subtitles.cacheDir` from `SUBS_CACHE_DIR`.
- Net effect: first play of a title still pays the extraction once; **every repeat play is instant.**

### 2. "Preparing…" notice during the wait (`packages/streambot`)

- `discord/status-reporter.ts` — while a **file** sits in `resolving`, schedule a one-shot notice
  after a delay (default 4s, injectable). It fires only if resolving outlasts the delay, so
  fast paths (cache hit / sidecar) stay silent and only the genuinely slow first extraction posts:
  _"⏳ Preparing **<title>** — extracting subtitles from a large file, which can take up to a
  minute. Playback will start automatically when it's ready."_ yt-dlp sources excluded (their
  latency is download, not extraction). De-duped by source label; cancelled when streaming starts.
  Timer injected via a `schedule` option so tests are deterministic (no real timers).
- `discord/status-reporter.ts` + `session/session-manager.ts` — `StatusSnapshot` gains
  `currentSourceLabel` (`sourceLabel(current.source)`), available during `resolving` before a
  title is known (`resolved` is still null then).

### 3. Homelab (`packages/homelab`)

- `cdk8s/src/resources/streambot.ts` — new 2Gi `ZfsNvmeVolume` (`streambot-subs-cache-pvc`,
  zfs-ssd, RWO, velero-backup-enabled) mounted at `/subs-cache`, with `SUBS_CACHE_DIR=/subs-cache`.
  Safe under the existing Recreate strategy (old pod detaches before new attaches).

## Verification

- `bun run --filter=./packages/streambot typecheck` → clean.
- streambot tests: 256 pass. New `test/subtitle-cache.test.ts` drives the real
  `resolveSubtitleForFile` with **fake** ffprobe/ffmpeg binaries: asserts extract-once →
  cache-hit (ffmpeg runs once), re-extraction on file change, and the no-cache fallback.
  New status-reporter tests cover the notice (fires on slow resolve, cancelled on fast,
  skipped for yt-dlp, de-duped). 4 pre-existing integration failures are the local Homebrew
  ffmpeg lacking the `subtitles` (libass) and `zscale` filters — environmental, not this change.
- `bun run --filter=./packages/homelab typecheck` → clean; `eslint` clean; cdk8s `src/app.ts`
  synth renders the PVC + mount + env correctly.

## Session Log — 2026-06-13

### Done

- Diagnosed the 30s–1m startup to embedded-subtitle pre-extraction (full-demux, ~56s for a
  61 GB / 2:48 remux), verified in-pod.
- Implemented a persistent, cheaply-keyed subtitle cache (instant repeat plays) and a delayed
  "preparing…" Discord notice for the slow first extraction. Added homelab PVC + env wiring.
- All streambot + homelab typecheck/lint/synth green; targeted tests added and passing.

### Remaining

- Open PR, let Buildkite build the streambot image + run the libass-enabled integration tests.
- After deploy: confirm first play of a fresh title posts the "Preparing…" notice and writes
  to `/subs-cache`, and that a second play of the same title starts within a few seconds.

### Caveats

- First play of each title still pays the one-time extraction; the cache only helps repeats.
  (A future enhancement could pre-warm the cache during the 5-min library scan.)
- Local `bun test` shows 4 integration failures from a libass/zscale-less Homebrew ffmpeg —
  expected on this dev Mac; CI's ffmpeg has them.
- Fresh-worktree typecheck needed the built discord-video-stream/discord-stream-lifecycle dist
  copied into `packages/streambot/node_modules` (known stale-dist friction; local-only).
