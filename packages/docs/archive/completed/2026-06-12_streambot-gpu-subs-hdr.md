---
id: reference-completed-2026-06-12-streambot-gpu-subs-hdr
type: reference
status: complete
board: false
---

# Streambot: fix subtitle selection, HDR tonemapping — full-GPU pipeline

## Context

Playing **Avengers: Endgame Remux-2160p** (HEVC 4K, PQ/BT.2020 HDR) surfaced the reported bugs (confirmed via Loki logs + ffprobe of the file):

1. **"Subtitles not working"** — streambot burned the sidecar `…en.forced.srt` (forced = foreign-dialogue-only, mostly empty). The file has a **full embedded English subrip**, but resolution is source-priority: any sidecar beats all embedded tracks (`subtitle-io.ts:207-232`).
2. **"HDR washed out"** — no tonemapping anywhere; logged chain was `scale=1920:1080,subtitles=…`. HDR is probed (`probe.ts` `isHdrTransfer`) but discarded after metrics.
3. **Hardware requirement (user)** — subtitles currently force the whole pipeline to software (`streamer.ts:214-218`); Loki shows frame sends at 110–360% of budget on the 4K remux. **Everything must stay on the GPU as much as possible**, including subtitle burns.

Verified in the deployed image (ffmpeg **7.1.4**, Debian trixie): `scale_vaapi`, `tonemap_vaapi`, `overlay_vaapi`, `hwupload`, `zscale`, software `tonemap`, `subtitles` filter with `alpha` option, libass. Node: Intel iGPU, iHD driver, `/dev/dri/renderD128`.

Bonus found during design: burned subs are **time-shifted after any seek** today (`-ss` before `-i` re-stamps PTS from 0, `subtitles=` picks cues by PTS) — fixed by the setpts sandwich below.

Out of scope: PGS (image) subtitle burn-in; the crashlooping pod / stale image pin (user said ignore).

## Fix 1 — Cross-source subtitle ranking

Rank **all** candidates (sidecar + embedded) together: language pref → modifier (full 0 < hi/sdh/cc 1 < forced 2) → source (sidecar < embedded, tie-break only) → deterministic tie-break. Pinned modifier (`sublang:en.forced`) restricts the pool first, preserving the explicit-forced override.

| File                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/streambot/src/sources/subtitles.ts`   | Extend ffprobe Zod schema with `tags.title`, `disposition.hearing_impaired`. New: `SubtitleCandidate` union (`sidecar`/`embedded`), `embeddedSubtitleModifier()` (dispositions, then SDH/FORCED title tags), `toEmbeddedCandidates()` (text codecs only), `rankSubtitleCandidates()` (best-first, reuses `languageScore`/`modifierScore`; language tags canonicalized so `en`/`eng`/`en-US` rank as one language). Reimplement `rankSidecars` + `pickEmbeddedSubtitle` as thin wrappers so rankers can't diverge. |
| `packages/streambot/src/sources/subtitle-io.ts` | Restructure `resolveSubtitleForFile`: gather sidecar + ffprobe embedded candidates, rank together, walk the ranked list staging each until one succeeds. Split `extractEmbedded` into probe (candidates) + `extractEmbeddedTrack(config, filePath, subtitleIndex, signal)`. `resolveSubtitleForYtdlp` untouched.                                                                                                                                                                                                  |

Endgame regression: embedded full eng (mod 0) now beats forced sidecar (mod 2). `sublang:en.forced` still picks forced.

## Fix 2 — Full-GPU pipeline: HDR tonemap + GPU subtitle overlay

Subtitles no longer force software. They render via libass on a transparent BGRA canvas (cheap, CPU), get `hwupload`ed, and composite on-GPU with `overlay_vaapi`. Decode, scale, tonemap, composite, encode all stay on the iGPU.

### dvs fork API (structured options replace string filters)

- `PrepareStreamOptions`: **remove** `videoFilters: string[]`; **add** `subtitleBurn?: { path: string }` and `inputColor: "sdr" | "hdr"` (default `"sdr"`). Only prepareStream can compose hw graphs (branch + device + PTS shift depend on startTime/dims/hw engagement); streambot is the only consumer.
- New pure module `packages/discord-video-stream/src/media/videoGraph.ts`: `VideoGraphSpec`, `VideoGraph` (`filterChain` for `-vf` | `filterComplex` + `mapVideo: "[vout]"`), `escapeFilterPath()` (`\ : ' , ; [ ]`), `subtitlePtsSandwich()`, `buildSoftwareVideoGraph()`. Replaces `buildVideoFilterChain` (deleted).
- `hwPipeline` contract (`encoders/index.ts`): `scaleFilter` replaced by `videoGraph: (spec: VideoGraphSpec) => VideoGraph`; only vaapi.ts implements it.

### Exact graphs (W=1920 H=1080 R=30, `SUB`=escaped path, `SS`=startTime)

- **GPU SDR no-subs** (unchanged): `-vf scale_vaapi=w=1920:h=1080:format=nv12`
- **GPU HDR no-subs**: `-vf scale_vaapi=w=1920:h=1080:format=p010,tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709` (scale at 10-bit, tonemap at 1080p — Jellyfin-style)
- **GPU + subs** (`-filter_complex`, `-map [vout]`; HDR variant swaps in the tonemap base chain):

  ```text
  [0:v]scale_vaapi=w=1920:h=1080:format=nv12[base];
  color=c=black@0:s=1920x1080:r=30,format=bgra,setpts=PTS+SS/TB,subtitles=filename=SUB:alpha=1,setpts=PTS-SS/TB,hwupload[subs];
  [base][subs]overlay_vaapi[vout]
  ```

  setpts pair omitted when `SS=0`. Canvas is `bgra` (libass-native; iHD hwupload accepts BGRA, `yuva420p` it does not — this is Jellyfin's proven graph with `color@0` standing in for `alphasrc`).

- **Software fallback** (HW→SW retry only): `scale=W:H[,pad][,TONEMAP][,setpts+SS,subtitles=SUB,setpts-SS][,outFilters]` where TONEMAP = `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p` (subs burn after tonemap, on SDR frames).

**Seek correctness**: `setpts=PTS+SS/TB` before `subtitles=` gives libass media-clock timestamps (right cues after `-ss`); `setpts=PTS-SS/TB` restores 0-based PTS so overlay framesync and `-r` are unaffected. Fixes the pre-existing SW seek bug too. The player re-invokes prepareStream per seek segment with the new `startTime`, so the shift is always current.

### Device plumbing (vaapi.ts)

Replace `-vaapi_device` with one named device shared by decoder and all filters (required: `overlay_vaapi` fails if its inputs are on different device contexts):

```
decodeOptions: -init_hw_device vaapi=va:<device> -filter_hw_device va -hwaccel vaapi -hwaccel_output_format vaapi -hwaccel_device va
globalOptions: -init_hw_device vaapi=va:<device> -filter_hw_device va   (sw-decode+outFilters path only)
```

`prepareStream` applies `globalOptions` only when `hwPipeline` is NOT active (both would double-init device `va` → hard error).

### prepareStream wiring (newApi.ts)

- Merge new options; `noTranscoding` + `subtitleBurn` → throw; `noTranscoding` + hdr → warn+ignore.
- `filterChain` → `-map 0:v` + `command.videoFilter(...)` (today); `filterComplex` → `command.complexFilter(graph, "vout")` and **suppress `-map 0:v`** (dual video maps would corrupt the NUT stream). fluent-ffmpeg verified: `complexFilter` emits before output options; audio `-map 0:a:0?` unaffected.
- Keep pad+hwPipeline warning; `-pix_fmt` skip on hw unchanged.

### streambot wiring

| File                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/streambot/src/machine/types.ts`     | `ResolvedSource` gains `readonly hdr?: boolean`.                                                                                                                                                                                                                                                                                                                                                              |
| `packages/streambot/src/sources/resolve.ts`   | `recordSourceMetadata` returns its `MediaInfo \| null`; `resolveSource` spreads `hdr: true` when probed HDR (probe failure ⇒ SDR, best-effort as today).                                                                                                                                                                                                                                                      |
| `packages/streambot/src/streamer/streamer.ts` | Delete subtitle→software forcing: `useHardware = config.stream.hardwareAcceleration`. prepareOpts: `subtitleBurn` from `resolved.subtitle`, `inputColor` from `resolved.hdr`. Drop `buildSubtitleFilter` import. **HW→SW retry untouched** — safety net for tonemap_vaapi/overlay_vaapi/BGRA-upload init failures (retry resumes at last position with same subtitleBurn/inputColor → SW tonemap+subs chain). |
| `packages/streambot/src/sources/subtitles.ts` | Delete `buildSubtitleFilter`/`escapeSubtitlePath` (escaping moves into the fork's `escapeFilterPath`).                                                                                                                                                                                                                                                                                                        |

## Tests

- **Fork unit** (`newApi.filters.test.ts` rewritten, `encoders-vaapi.test.ts`, `player.test.ts`): exact-string assertions for every graph variant (SW/GPU × sdr/hdr × subs/no-subs × SS=0/>0 × pad/outFilters); `escapeFilterPath` metachars; noTranscoding guards; new vaapi decode/globalOptions; player fake asserts `subtitleBurn` + per-segment `startTime` survive seeks.
- **Streambot unit**: `subtitles.test.ts` — `embeddedSubtitleModifier`, schema round-trip, `rankSubtitleCandidates` with the literal Endgame fixture (embedded full wins; pinned forced wins; sidecar beats embedded at equal quality), full > SDH > forced for embedded. Streamer tests (fake player factory): subs present ⇒ still `hardwareAcceleratedDecoding: true` + `subtitleBurn` passed; `inputColor` threading; HW failure ⇒ SW retry keeps both.
- **Integration** (Dagger streambot image, real ffmpeg, Linux, no GPU):
  - Endgame-shaped fixture: embedded full cue + forced sidecar → full cue chosen; pinned `en.forced` → forced cue.
  - SW HDR chain on a synthetic HDR clip (lavfi testsrc, yuv420p10le + bt2020/smpte2084 flags, libx265) → output probes `bt709`/`yuv420p`; `probeMedia` → `hdr: true`.
  - **Seek regression**: cue at 4–6s, `-ss 5` ⇒ cue visible (sandwich works).
  - GPU subs-branch proxy: same graph with plain `overlay` instead of `hwupload`+`overlay_vaapi` — validates alpha canvas + libass + framesync without a GPU.
  - `tonemap_vaapi`/`overlay_vaapi` themselves: not CI-testable; covered by runtime HW→SW retry + `streambot_hw_fallback_total`.

## Verification

1. `bun run typecheck` + `bun test` in both packages; `bunx eslint . --fix` each.
2. Integration suites via the streambot Dagger target.
3. Post-deploy: replay the Endgame remux — expect full English subs, correct SDR colors, and `hwDecodeEngaged: true` in the logged ffmpeg command (filter_complex with overlay_vaapi present); confirm `streambot_hw_fallback_total` doesn't increment and no frame-send budget warnings in Loki.

## Implementation order

1. Fork: `videoGraph.ts` pure builders + tests
2. Fork: encoders contract + vaapi named-device + tests
3. Fork: newApi option/wiring + tests
4. Streambot: HDR threading (types/resolve) + streamer wiring + tests
5. Streambot: subtitle ranking (Fix 1) + tests
6. Integration tests; full verification

## Risks

- `tonemap_vaapi`/`overlay_vaapi`/BGRA-upload are GPU-generation-dependent on iHD; unverifiable in CI → existing HW→SW retry is the net; validate on the deployed box at rollout and watch `hwFallbackTotal`.
- Named-device refactor touches the working no-subs VAAPI path (regression risk; same retry covers it).
- Cue boundaries snap to the 30fps canvas grid (≤33ms) — imperceptible.
- Behavior changes: embedded full now beats forced sidecar (intended; `sublang:en.forced` preserved); SW-path subs after seek now correct (pre-existing bug fixed).

## Session Log — 2026-06-12

### Done

- **Fork (`packages/discord-video-stream`)** — commit `7e5b29f9f`: new pure `src/media/videoGraph.ts` (`buildSoftwareVideoGraph`, `buildVaapiVideoGraph`, `escapeFilterPath`, `subtitlePtsSandwich`, `SOFTWARE_TONEMAP_CHAIN`); `PrepareStreamOptions` swaps `videoFilters` for `subtitleBurn` + `inputColor`; `hwPipeline.videoGraph` replaces `scaleFilter`; named VAAPI device (`-init_hw_device vaapi=va` + `-filter_hw_device va`) shared by decoder and filters; filter_complex path suppresses `-map 0:v`; `globalOptions` apply only off the hw pipeline. 34 unit tests (exact-string graph assertions).
- **Streambot pipeline wiring** — commit `41fd848eb`: subtitles no longer force software; `ResolvedSource.hdr` threaded from `probeMedia` → `resolveSource` → `streamer.ts` `inputColor`; HW→SW retry untouched (safety net for `tonemap_vaapi`/`overlay_vaapi` on older iGPUs). New `test/streamer-pipeline.test.ts`.
- **Cross-source subtitle ranking** — commit `fb502ce3c`: `rankSubtitleCandidates` ranks sidecar + embedded together (language → full/SDH/forced → source tie-break); language tags canonicalized (`eng`→`en`, region stripped) — without this the `en` forced sidecar still beat the `eng` embedded track via list-position scoring; embedded modifiers read `hearing_impaired` disposition + SDH/FORCED titles; `resolveSubtitleForFile` walks the ranked list with stage-failure fallthrough.
- **Integration tests** (rewritten `integration/subtitles.integration.test.ts`): Endgame fixture (full embedded beats forced sidecar; `sublang:en.forced` still pins), seek PTS-compensation regression (cue at 4–6s, `-ss 5`: compensated graph renders it, naive graph provably misses it), software HDR tonemap chain → ffprobe `bt709`/`yuv420p`, GPU canvas branch via software `overlay` proxy. **All 12 pass inside the real image** (`dagger call smoke-test-streambot`, exit 0; smoke boot also green).
- Docs: this plan mirrored from the harness plan; `packages/streambot/AGENTS.md` Subtitles section rewritten + new HDR section.

### Remaining

- Merge the PR (`feature/streambot-gpu-subs-hdr`), then post-deploy verification on torvalds: replay the Endgame remux and check (a) full English subs render, (b) colors not washed out, (c) Loki `ffmpeg command` shows `-filter_complex … overlay_vaapi` with `hwDecodeEngaged: true`, (d) `streambot_hw_fallback_total` does not increment, (e) no frame-send budget warnings.
- The cluster ran image `2.0.0-3721` while `versions.ts` is also at `3721` but main's other images are at `3745+` — the streambot CI commit-back appears stale; worth checking the next image push picks this work up (out of scope per user: the config-schema crashloop of the running pod).

### Caveats

- `tonemap_vaapi`/`overlay_vaapi`/BGRA `hwupload` cannot be exercised in CI (no GPU in Dagger); their first real test is on the deployed iGPU. The HW→SW retry covers a failure, at software-encode speed (slow on 4K, but correct + tonemapped + subtitled).
- Behavior change: a full embedded track now beats a forced-only sidecar by default; `sublang:en.forced` preserves the old behavior on request.
- Pre-existing bug fixed in passing: burned subtitle cues were time-shifted after every `/stream seek` / resume (libass saw post-`-ss` re-stamped PTS). Both paths now wrap `subtitles=` in a `setpts` sandwich.
