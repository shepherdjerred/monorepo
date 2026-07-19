---
id: log-2026-07-18-streambot-f1-stutter-investigation
type: log
status: complete
board: false
---

# Streambot F1-night stutter investigation (2026-07-17 evening)

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

### 7. Root cause (2026-07-18 evening): zero-slack realtime pacing, not transcode capacity

Stage-isolation benchmarks inside the streambot pod (same file, same heavy
scene via `-ss 6060`, unbounded, 60 s segments) killed the
"serialization/capacity" theory:

| Configuration                                             | Speed                   |
| --------------------------------------------------------- | ----------------------- |
| decode only                                               | 11.7x                   |
| decode + scale_vaapi                                      | 11.7x                   |
| decode + scale + tonemap_vaapi                            | 8.8x                    |
| full prod graph (encode, no subs)                         | **6.6x**                |
| full + `-async_depth 4/8` + `extra_hw_frames`             | 6.6x (no change)        |
| full prod command, `-readrate 1`, `-f null` (no consumer) | **~1.0 clean, no dips** |
| full prod command, `-readrate 1`, piped to `cat`          | ~1.0 clean, no dips     |
| live (real consumer)                                      | dips 0.72–0.94          |

The pipeline has **6.6x capacity** on the worst scene. During a live dip,
per-thread sampling showed every ffmpeg and bun thread idle (bun main ~12%,
zero threads blocked in `pipe_write`, demux thread sleeping in the readrate
timer). The dips require the real consumer: since PR #1196 (`-readrate 1`,
merged 2026-06-13 — the exact "perf was great" baseline boundary), production
is paced to exactly realtime while the consumer chain holds zero slack
(`highWaterMark: 0` streams + 64 KB kernel pipe ≈ 1–2 frames). Any transient
consumer-side hiccup back-propagates instantly, stalls the whole graph, and
the losses accumulate as visible stutter on heavy-bitrate scenes. PR #1196
traded unbounded-buffer GC pauses for zero-margin lock-step.

Also: the stream-observer doc comment claimed "ffmpeg is not readrate-limited"
— stale since PR #1196; it misdirected this investigation for several hours.

### 8. Fix (this branch)

Plumb ffmpeg's `-readrate_initial_burst` through the dvs fork
(`prepareStream`) and pair it with the fork's existing-but-never-wired
play-side `readrateInitialBurst` pacer logic. The first N seconds (config
`stream.readrateInitialBurst`, env `STREAM_READRATE_INITIAL_BURST`, default
2.5 s) demux at full speed and the pacer forwards them into the Discord
receiver's jitter buffer. Production dips then drain that cushion instead of
starving the sender, and `readrate`'s wall-clock-line semantics let ffmpeg
catch back up (unthrottled while behind the line) to refill it. The pre-roll
is bounded (a few MB), so it cannot recreate the GC-pause failure mode that
PR #1196 fixed. Every seek segment gets a fresh burst (the option rides
`options.prepare`/`options.play` through `createSeekablePlayer`).

### 9. Live verification of the fix (test pod, same scene, 10 min @ 20 s samples)

| Round   | Code                   | Mean speed | Deficit behavior                                                                |
| ------- | ---------------------- | ---------- | ------------------------------------------------------------------------------- |
| 1       | cushion only           | 0.942      | monotonic growth to 37.7 s — insufficient                                       |
| 2       | cushion + pacer fix    | **0.990**  | returns to zero 5× (full recovery); worst transient 14.4 s in the heaviest tail |
| control | null sink, no consumer | 0.999 flat | capacity proof — no scene exceeds the pipeline                                  |

Round 2 ran partly against a concurrent unbounded benchmark on the same GPU
(conservative). Event-loop lag p99 stayed 1.8–3.9 ms throughout — no GC
regression. Residual: the heaviest ~90 s stretch can still transiently exceed
the ~6.7 s cushion (receiver pre-roll + vPipe); whether that is
viewer-visible needs the `playback_behind_seconds` gauge (next-steps 6.1).
Mitigation without code: raise `STREAM_READRATE_INITIAL_BURST`.

## Suggested next steps

1. ~~A/B the subtitle hypothesis~~ — done 2026-07-18, refuted (§6).
2. ~~Profile the core pipeline~~ — done 2026-07-18, capacity is 6.6x; root
   cause is zero-slack pacing (§7), fixed by the pre-roll cushion (§8).
3. **Post-deploy verification:** replay Avengers @ 1:41 and confirm (a) no
   sustained sub-1.0 stretches beyond the cushion, (b)
   `streambot_nodejs_eventloop_lag_p99_seconds` stays low (no GC regression),
   (c) `-readrate_initial_burst 2.5` visible in the logged ffmpeg command.
4. Raise event-exporter `maxEventAgeSeconds` so future pod-lifecycle causes
   aren't lost from telemetry (the manual restart was untraceable from
   metrics/events alone).
5. Fix gauge reset on stream end (repro'd 3× now: post-Top-Gun, both A/B
   teardowns) + add pod-churn visibility to the dashboard.
6. **Observability follow-up** (ranked by time it would have saved this
   session; 1–3 are small additions to the packages this PR touches):
   1. `streambot_playback_behind_seconds` gauge + late-frames-vs-schedule
      counter in the pacer — measures the user-facing symptom directly
      (everything this session was inferred from production-side proxies).
   2. Pacer sync-correction counters (`pacer_sync_events_total{direction}`,
      `pacer_schedule_reset_lost_ms_total`) — the root cause lived in an
      uninstrumented code path that already computes every number it discards.
   3. Demux→pacer queue-depth gauge (vPipe occupancy) — instantly separates
      producer-starved from consumer-paced dips.
   4. Dashboard: correct the speed-ratio panel description (1.0 = ceiling
      since `-readrate 1`, >1.0 = catch-up, not headroom) and alert on
      `avg_over_time(speed_ratio[5m]) < 0.97 and stream_active == 1`.
   5. Reset ffmpeg-derived gauges on stream end, or mask stale samples in
      panels via the existing `ffmpegProgressAgeSeconds`.
   6. Homelab: event-exporter `maxEventAgeSeconds`, pod-churn panel
      (`kube_pod_start_time` changes), and eventually a node-level DRM-clients
      exporter for whole-GPU tenancy visibility.

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
  exonerated; reliable stutter repro established (Avengers @ 1:41, dips to
  0.72).
- Root-caused via in-pod benchmarks + per-thread sampling (§7): 6.6x
  transcode capacity; dips are zero-slack `-readrate 1` lock-step with the
  highWaterMark-0 consumer, introduced by PR #1196.
- Implemented the fix (§8): `-readrate_initial_burst` plumbed through the dvs
  fork + streambot config (default 2.5 s pre-roll into the receiver's jitter
  buffer); stale stream-observer comment corrected; emission tests added.
  Branch `feature/streambot-pipeline-depth`.

### Remaining

- Merge the PR, let ArgoCD deploy, and run post-deploy verification
  (next-steps 3): Avengers @ 1:41 replay + event-loop-lag check.
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
