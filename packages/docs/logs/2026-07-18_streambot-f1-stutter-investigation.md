# Streambot F1-night stutter investigation (2026-07-17 evening)

## Status

Complete (investigation only — no changes made)

## What the user saw

Lag/stutter while watching movies over streambot on the evening of 2026-07-17
(Avengers: Infinity War 19:25–21:55 PDT, then F1 (2025) 21:55 PDT–00:22 PDT).
Both are 2160p HEVC HDR remuxes with embedded-subtitle burn-in.

## Findings (from Grafana: `streambot` dashboard metrics + Loki logs)

### 1. The stutter is real and measurable — ffmpeg fell below realtime

- **Avengers window (19:25–21:55 PDT):** `streambot_ffmpeg_speed_ratio` was
  below 1.0 for **33 of 75 samples (~66 min of 150)**, worst dips 0.54 (21:08),
  0.66 (21:40), 0.68 (21:14), 0.72–0.74 repeatedly 20:00–21:06.
- **F1 window (21:55–00:22 PDT):** mostly healthy (median 1.0, p95 1.14) with
  brief marginal dips: 0.94 @ 23:10 and 23:16, 0.92 @ 00:16. Enough for
  occasional visible stutter, far milder than the Avengers window.

### 2. A pod replacement interrupted F1 mid-movie at 22:37 PDT — **user-initiated**

- 42 min into F1, the streambot pod received SIGTERM ("shutting down"), a new
  pod came up ~5 s later, and session-manager **resumed F1 at the exact
  position** (`-ss 2556`). User-visible dropout of roughly 5–10 s.
- **Resolved:** the user manually restarted the pod mid-movie to see if it
  would help the lag. It didn't — speed ratio behavior was the same before
  (hovering at 1.0, 22:10–22:40) and after (dips to 0.94/0.92 at
  23:10/23:16/00:16), consistent with a per-play pipeline bottleneck rather
  than accumulated process state.
- Investigation notes kept for reference: same ReplicaSet hash
  (`5dd65bc65d`) across all three pod names in 36 h → not an image
  deploy/rollout; ArgoCD idle at both replacement times; no node pressure,
  OOM, throttling, or reboot. The kubernetes-event-exporter discarded the
  delete events as older than `maxEventAgeSeconds`, which is why the manual
  restart couldn't be identified from telemetry alone.

### 3. No resource is saturated — the pipeline simply has no headroom

During the stutter windows, every measured resource was comfortable:

| Resource                               | During stutter                                 |
| -------------------------------------- | ---------------------------------------------- |
| streambot container CPU                | ~0.73 cores steady (limit 12, zero throttling) |
| GPU render engine (1m res)             | ~15–16 % flat                                  |
| GPU video/decode engine (1m res)       | ~11–14 %                                       |
| Node total CPU                         | ~3.3 cores flat, same as healthy window        |
| Node disks (`node_disk_io_time`)       | all devices < 20 % util                        |
| Send path (`send_frametime_ratio` p95) | 0.24 of frame budget, both kinds               |
| Late frames                            | zero                                           |
| Event loop p99                         | ~4 ms                                          |

So ffmpeg was slower than realtime while CPU, GPU, disk, and the Discord send
path all report idle-ish. The transcode is riding at ~1.0x with almost no
burst headroom (p95 only 1.14–1.2 when it catches up).

### 4. ~~Prime suspect: subtitle burn-in path~~ — **REFUTED by live A/B (see §6)**

Per memory `streambot-perf-baseline-2026-06-14`: on 2026-06-14 (before the
subtitle-cache fix), 4K HDR played stutter-free — because the broken cache
meant embedded subs were never extracted, so the burn-in branch never ran.
Both of last night's ffmpeg commands include the full burn-in chain:

```
color=black@0:s=1920x1080:r=30,format=bgra,subtitles=...srt,hwupload[subs];
[base][subs]overlay_vaapi
```

Both plays were cache **hits** (extraction cost is not the issue) — the cost
is the per-frame chain: libass render → 1080p30 BGRA (~250 MB/s) → `hwupload`
→ `overlay_vaapi`, largely serialized inside ffmpeg's filter graph. This
matches the memory's predicted regression, via overlay cost rather than
extraction cost. A single mostly-serial filter pipeline also explains the flat
~0.73-core CPU with no visible saturation: the bottleneck is one thread
blocking on GPU round-trips (upload/sync), which shows up as neither CPU nor
GPU-engine saturation.

### 5. Bonus observability bugs noticed

- **Frozen gauges:** after Top Gun: Maverick ended (~00:04 PDT Jul 17),
  `streambot_stream_active` stayed 1 and `speed_ratio`/`fps` froze at
  1.397/25 for ~16 h until the pod was replaced at 17:06 PDT. Gauges are not
  reset when a stream ends (or the session wedged).
- **Restart panel blind spot:** the dashboard's "Container restarts" panel
  tracks `kube_pod_container_status_restarts_total`, which stays 0 when the
  _pod_ is deleted and recreated (as happened twice). Pod churn is invisible.
- **Event exporter losing events:** `maxEventAgeSeconds` too low → the two
  pod-replacement causes were discarded. Raising it (or capturing FirstSeen)
  would have answered finding #2.

### 6. Live A/B test (2026-07-18 afternoon): subtitles exonerated, core pipeline confirmed

Drove streambot via the test userbot (`derrej_`) in Diamond Dudes
(`/stream play` + `/stream seek`, Glidiot Helper bot `1512990470202982560`),
measuring `streambot_ffmpeg_speed_ratio` for ~8 min per phase on the idle node:

| Phase | Content / position          | Subs | Result                                                      |
| ----- | --------------------------- | ---- | ----------------------------------------------------------- |
| A     | F1 opening                  | off  | 1.0 flat (initial burst 1.75)                               |
| B     | F1 opening                  | on   | 1.0 flat; GPU render 16.0% vs 11.5% (subs cost ≈ +40% rel.) |
| C     | F1 @ 1:15:00 (race)         | on   | 1.0 flat — last night's mild dip not reproduced             |
| D     | Avengers @ 1:41:00 (battle) | on   | **dips 0.74–0.94**, catch-up bursts 1.4                     |
| E     | Avengers @ 1:41:00 (battle) | off  | **dips 0.72–0.94**, initial burst 1.94                      |

**Conclusion:** D ≈ E ⇒ the subtitle chain adds measurable GPU load but is NOT
the stutter cause. The core VAAPI pipeline (4K HEVC HDR decode → scale_vaapi →
tonemap_vaapi → h264_vaapi) cannot sustain 1.0x through peak-bitrate scenes —
reproduced in isolation on an idle 32-core node with no other GPU tenants, no
viewers, no subtitles. Catch-up ceiling ≈ 1.4x (subs on) / 1.9x (subs off) on
light content; heavy battle scenes drop it to ~0.72–0.94. Last night's stutter
= this scene-dependent deficit (Avengers heavy stretch 1:41–2:23 was the worst;
F1 is a lighter encode and only grazed the limit). The June-14 "perf was great"
baseline claim of sustained 1.4x traces to the frozen-gauge artifact (§5), so
the pipeline may have been marginal on peak scenes all along.

Bonus repro during testing: the frozen-gauge bug (§5) hit twice — after each
stream end, `speed_ratio` froze at its last value (1.942 for 10+ min). Unlike
the Jul-17 Top Gun case, `stream_active` did reset to 0, so the freeze is
per-gauge: ffmpeg-derived gauges are never cleared, while `stream_active` is.
Suspected per-frame serialization (decode→scale→tonemap→encode round-trips)
rather than engine saturation — engines all read ≤ 17% during dips. Likely fix
territory: `-async_depth` on the VAAPI filters/decoder, `extra_hw_frames`,
pipeline depth tuning, or hybrid decode. Needs a dedicated session.

## Suggested next steps (not done — awaiting direction)

1. ~~A/B the subtitle hypothesis~~ — **done 2026-07-18, refuted (§6).**
2. **Profile the core pipeline on a heavy scene** (Avengers @ 1:41 is a
   reliable repro): try `-async_depth` on scale_vaapi/tonemap_vaapi and the
   VAAPI decoder, `extra_hw_frames`, and compare; Pyroscope flamegraph of the
   ffmpeg process during a dip to find the serialized stage.
3. Raise event-exporter `maxEventAgeSeconds` so future pod-lifecycle causes
   aren't lost from telemetry (the manual restart was untraceable from
   metrics/events alone).
4. Fix gauge reset on stream end (repro'd 3× now: post-Top-Gun, both A/B
   teardowns) + add pod-churn visibility to the dashboard.

## Workflow Friction

- **`toolkit discord` has no member/bot-ID lookup.** `slash <channelId> <botId> …`
  requires the target bot's user ID, but no CLI command can discover it. Finding
  Glidiot Helper's ID meant scaffolding a scratch dir, `bun add
discord.js-selfbot-v13 debug`, writing a member-listing script, and an extra
  `op` call. Fix: add `toolkit discord members <guildId> [--query <name>]`
  (gateway member fetch via whichever identity is loaded) and mention it in the
  `discord` skill. Low effort, saves ~5 min every bot-driving session.
- **`toolkit discord read --json` emits non-JSON on errors** (`Daemon error:
Missing Access` as plain text), which breaks piped parsers. Emit
  `{"error": …}` when `--json` is set.
- **Slash optional-arg skipping undocumented** — positional args worked
  (`"stream play" "F1 (2025)" "off"`), but there's no documented way to pass a
  later optional (e.g. `sublang`) while skipping an earlier one (`subtitles`).
  One sentence in the `discord` skill would cover it.
- (Separate tool) `toolkit grafana log-label-values` crashes on `--from`
  (parseArgs rejects it) and 404s without it via the proxy path; I fell back to
  raw `curl` against `/api/datasources/proxy/uid/loki/...`. Worth a look.

## Session Log — 2026-07-18

### Done

- Queried Grafana (Prometheus + Loki via `toolkit grafana`) for streambot
  metrics/logs covering 2026-07-17 00:00 → 2026-07-18 07:30 UTC.
- Identified stream windows, per-window speed-ratio/fps/lag/CPU/GPU/disk/send
  analysis (scripts in session scratchpad: `analyze.ts`, `f1window.ts`,
  `contention.ts`).
- Ruled out: CPU saturation, CFS throttling, GPU engine saturation, disk
  util, send-path latency, event-loop lag, OOM, node pressure, node reboot,
  ArgoCD sync/deploy.
- Correlated the 22:37 PDT F1 interruption with an unexplained pod
  replacement (graceful SIGTERM, same ReplicaSet).

- Ran live A/B via Discord test userbot (phases A–E, §6): subtitles
  exonerated; core VAAPI pipeline confirmed unable to hold 1.0x on
  peak-bitrate scenes (reliable repro: Avengers @ 1:41, dips to 0.72).

### Remaining

- Fix the core pipeline throughput on heavy scenes (async_depth /
  extra_hw_frames / Pyroscope profiling — §6 and next-steps 2).
- Observability fixes: gauge reset on stream end, pod-churn panel, event
  exporter `maxEventAgeSeconds`.

### Caveats

- The 22:37 PDT pod replacement was the user manually restarting the pod
  (confirmed in-session; it did not help the lag). The 17:06 PDT replacement
  is presumably also operator-initiated but unconfirmed.
- GPU engine metrics come from streambot's own gpu-collector
  (`streambot_gpu_engine_seconds_total`); busy-wait/sync stalls on VAAPI may
  not appear as engine busy time, so "GPU 15%" does not fully exonerate the
  GPU round-trip path.
- Speed-ratio samples are 2-min scrape resolution; short sub-second stutters
  may exist beyond what's counted here.
