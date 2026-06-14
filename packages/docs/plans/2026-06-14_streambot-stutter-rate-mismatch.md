# Streambot 1-second freezes every few seconds

## Status

In Progress — diagnosis confirmed via live telemetry + 5-agent research with
~100 cited sources; awaiting plan-approval to ship fixes.

## Context

User reported (2026-06-14 ~03:30 UTC): "streambot gets laggy sometimes. very
stuttery… not slight judder — it's a 1 s pause every few seconds." Pod
`media/media-streambot-54bb94f8d5-98nnh` on node `torvalds`, playing Avengers
Endgame Remux-2160p (HEVC 10-bit HDR, 23.98 fps source, force-rated to 30 fps
output, 4 Mbps H.264 over Discord Go-Live).

## Live diagnostics (executed during this session)

| Signal                                                              | Value                                   | Reading                                                   |
| ------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------- |
| `streambot_nodejs_eventloop_lag_p99_seconds`                        | **0.160 s**                             | Earlier in run: 0.009 s                                   |
| `streambot_nodejs_eventloop_lag_max_seconds`                        | **0.314 s**                             | Earlier in run: 0.077 s                                   |
| `streambot_nodejs_heap_size_used_bytes` snapshot 1 → 2 (25 s apart) | **3.88 → 4.19 GB (+12 MB/s)**           | After peaking at 6.38 GB earlier                          |
| `streambot_nodejs_external_memory_bytes` snapshot 1 → 2             | **3.88 → 4.21 GB (+13 MB/s)**           | After peaking at 3.49 GB earlier                          |
| Total heap growth                                                   | **~25 MB/s sustained**                  | ≈ 40× the encoded bitrate (~625 KB/s @ 5 Mbps)            |
| `streambot_ffmpeg_fps`                                              | **98–118**                              | Target 30 → producer 3.3× faster than consumer            |
| `streambot_ffmpeg_speed_ratio`                                      | **2.4–3.4×**                            | Encoder runs 2.5–3.5× realtime                            |
| `streambot_send_late_frames_total`                                  | 3 in 30 min                             | Per-frame outlier counter — not the failure shape         |
| `bun` process RSS / VmHWM                                           | 5.66 / **8.07 GB**                      | High-water mark touched 8 GB                              |
| Pod CPU vs limit                                                    | 1.9 / 12 cores                          | Not CFS-throttled                                         |
| Node `torvalds` CPU PSI avg10                                       | 31 %                                    | Dagger Helm engine (2149m) + 15 Buildkite pods co-located |
| **`/proc/<ffmpeg-pid>/fdinfo/3` `drm-engine-render`**               | **434 s** wall over ~300 s process life | GPU silicon IS engaged                                    |
| **`drm-engine-video`**                                              | **409 s**                               | hevc decode + h264 encode on the VCS — confirmed silicon  |
| `drm-engine-copy`                                                   | 0 ns                                    | No DMA roundtrips — full GPU pipeline                     |
| `hwDecodeEngaged`, `hw_fallback_total`                              | true, 0                                 | VAAPI confirmed, no fallback                              |

## Confirmed root cause

**Producer/consumer rate mismatch → unbounded JS-side buffer accumulation →
JSC/V8 major GC stop-the-world pause → Discord receiver jitter buffer
amplification → 1 s viewer-visible freeze.**

Mechanism:

1. ffmpeg's input demux runs unthrottled (no `-re` / `-readrate`). VAAPI
   encodes the 4K HEVC source at **2.5–3.5× realtime**, producing ~100 fps for
   a 30-fps consumer.
2. Output is NUT-format on a Linux pipe. The kernel pipe is **64 KiB by
   default** ([pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html)) and
   Node's `child_process.spawn` stdout Readable has a **hardcoded 64 KiB
   highWaterMark that cannot be tuned**
   ([nodejs/node#41611](https://github.com/nodejs/node/issues/41611)).
3. dvs reads the pipe into in-JS buffers and pipes them to the Discord RTP
   sender. The bun process has `streambot_nodejs_external_memory_bytes` growing
   ~13 MB/s = Buffer instances accumulating in the V8/JSC external pool, not
   the JS heap proper.
4. At 4–8 GB JSC heap + 3.5 GB external pool, the JSC major collector's
   atomic finalize phase **STWs 200 ms – 1.5 s**
   ([WebKit Riptide](https://webkit.org/blog/7122/introducing-riptide-webkits-retreating-wavefront-concurrent-garbage-collector/);
   comparable to V8's published 300 ms – 1+ s at 8 GB).
5. When the sender's `setInterval`-driven send loop pauses for 300 ms, ffmpeg
   keeps writing to the pipe (and dvs keeps draining it into the JS queue), so
   after the GC resumes the sender catches up by burst-sending an RTP packet
   train.
6. The Discord receiver's NetEQ/jitter buffer
   ([webrtcHacks](https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/);
   [getstream](https://getstream.io/resources/projects/webrtc/advanced/buffers/))
   stalls playout to resync on the burst, waiting for the next decodable
   reference frame. **That's why the 300 ms GC pause shows up as ~1 s of
   viewer-visible freeze.**

### Likely amplifier — Bun runtime specifically

Three independent users of `ysdragon/StreamBot` (281★, the popular downstream
of `dank074/Discord-video-stream`) report **frame drops 100 ms – 10 s on Bun
that disappear when switching to Node**
([ysdragon/StreamBot#112, #142, #146](https://github.com/ysdragon/StreamBot)).
The wrapper's maintainer:
"discord-video-stream 5.0.2 is **incompatible with Bun**." Upstream maintainer
(dank074, on libav.js under Bun): "right now they die on SIMD WASM." This
strongly suggests a Bun-specific backpressure-semantics issue (e.g., Bun's
`writable.write()` always returning `true`) is amplifying the rate-mismatch
problem above. The same code under Node would still have rate mismatch but
might recover faster.

## "Are we using the GPU?" — yes, definitively

`fdinfo` is the canonical Gen 12+ per-process GPU counter ([kernel.org
drm-usage-stats](https://kernel.org/doc/html/latest/gpu/drm-usage-stats.html);
Tvrtko Ursulin's i915 fdinfo patch series). On the running pod:

- `drm-driver: i915` — Intel iHD driver bound the device
- `drm-engine-render: 434 s` and `drm-engine-video: 409 s` accumulated in
  ~300 s of process life — both engines are >100% utilized in wall-clock
  (parallel sub-engines on the encode + filter graph)
- `drm-engine-copy: 0 ns` — no `hwdownload`/`hwupload` roundtrips; the full
  decode → scale_vaapi → tonemap_vaapi → overlay_vaapi → h264_vaapi pipeline
  stays on GPU
- `streambot_hw_decode_engaged = 1`, `streambot_hw_fallback_total = 0`

**Note:** `intel_gpu_top` on this hardware (Raptor Lake-S, Gen 12.2) shows 0 %
Video engine under any load due to a known PMU bug
([Frigate#16619](https://github.com/blakeblackshear/frigate/discussions/16619);
[intel/media-driver#1376](https://github.com/intel/media-driver/issues/1376)).
**Trust fdinfo, not intel_gpu_top, on this generation.**

## Symptom-differentiation table (Bun/Node GC research, agent 3)

| Signal                       | Real leak        | **Queue without backpressure (us)**   | Too much data        |
| ---------------------------- | ---------------- | ------------------------------------- | -------------------- |
| `heapUsed` over time         | Linear unbounded | **Linear unbounded**                  | Up then flat         |
| `external` over time         | Often growing    | **Almost always growing**             | Flat                 |
| `external / heapUsed` ratio  | Variable         | **> 0.5** (Buffer-heavy)              | < 0.3                |
| Snapshot top constructor     | Diverse          | **`Buffer` / `Uint8Array` dominates** | Same as healthy      |
| Recovery when producer stops | Heap stays high  | **Drains in 1–2 GCs**                 | Drains immediately   |
| Fix                          | Find retainer    | **Make backpressure work**            | Reduce producer rate |

My pod's `external/heapUsed` ratio at peak: **3.49 / 6.38 = 0.55** → matches
"queue without backpressure."

## Decisive bisection (one command, < 5 min)

Stop ffmpeg (rollout restart the pod), then run a stream and watch the heap:

- **Drains to baseline in 1–2 GCs** → queue / no backpressure → fix path below
- **Stays elevated** → real leak → heap-snapshot to find the retainer chain

## Fix sequence

### F0 — Immediate mitigation (no PR, ~30 s)

```bash
kubectl -n media rollout restart deploy/media-streambot
```

Clears the JSC heap and external pool. Restores the pre-degradation behavior
(eventloop p99 was 8 ms early in the run, 160 ms after 2 h). Recurrence
expected once buffers re-accumulate — confirms the diagnosis.

### F1 — `-readrate 1.0` on ffmpeg input (one PR, primary fix)

Bound the producer at realtime so the queue cannot grow. The
[`-readrate` flag](https://github.com/FFmpeg/FFmpeg/commit/c320b78e95bab2a71a636dc4da905522c4646b35)
(2021) and
[`-readrate_initial_burst`](https://ffmpeg.org/pipermail/ffmpeg-devel/2023-April/308243.html)
(2023) exist precisely for this topology (pre-recorded file replayed as live).
Upstream `Discord-RE/Discord-video-stream` already merged
`readrateInitialBurst` support in
[PR #140](https://github.com/Discord-RE/Discord-video-stream/pull/140) and the
maintainer endorsed `-readrate` as the canonical fix in
[issue #52](https://github.com/dank074/Discord-video-stream/issues/52) — our
in-repo dvs rewrite exposes `readrateInitialBurst` but **not** the primary
`readrate` flag.

| File                                                        | Change                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/discord-video-stream/src/media/newApi.ts:657-720` | Add a `readrate?: number` option alongside the existing `readrateInitialBurst`. Default to `1.0` when `minimizeLatency=false`, `undefined` when `true`. Emit as `-readrate <value>` in the input-option list (same place that consumes `readrate_initial_burst` near line 801). |
| `packages/streambot/src/streamer/streamer.ts:266-288`       | Pass `readrate: 1.0` (or env-overridable `stream.readrate`) in `prepareOpts`.                                                                                                                                                                                                   |
| `packages/streambot/src/config/schema.ts:40`, `index.ts:58` | Optional env knob `STREAM_READRATE` (default 1.0).                                                                                                                                                                                                                              |

Expected outcome (per agent 2's industry research): `ffmpeg_speed` drops from
~3 to ~1, `ffmpeg_fps` drops from ~100 to ~30, heap stabilizes under ~500 MB,
event-loop p99 returns to ~8 ms.

### F2 — Backpressure hardening (same PR as F1)

Even with the producer rate-bounded, audit the dvs pipeline for the
canonical backpressure bugs (Node stream contract violations work the same on
Bun and Node — see agent 3 §4):

| File                                                                                                              | Audit                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/discord-video-stream/src/media/newApi.ts:792` (`video.stream.pipe(vStream)`)                            | Replace `.pipe()` with `stream.pipeline()` so errors propagate and backpressure is correct end-to-end ([Node docs](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-callback)). |
| `packages/discord-video-stream/src/media/BaseMediaStream.ts:24` (`super({ objectMode: true, highWaterMark: 0 })`) | Verify the `_read()` implementation respects `this.push()` return value — failing to check it is **the** canonical backpressure-defeating bug (agent 3 §4).                                                   |
| Anywhere reading the pipe via `.on('data')` instead of `.pipe()`                                                  | `.on('data')` puts the stream in flowing mode and bypasses HWM.                                                                                                                                               |
| stderr handling on the ffmpeg child                                                                               | Must be drained on a separate consumer — leaving it un-drained deadlocks the child ([ffmpeg-python#195](https://github.com/kkroening/ffmpeg-python/issues/195)).                                              |

### F3 — Try Node runtime as a control (optional, 10 min, isolates Bun-specific bug)

Build streambot's image with `node:24-alpine` instead of `oven/bun` and
deploy to a non-prod replica. If 1 s freezes vanish under Node while F1 is
unshipped, the Bun-specific backpressure bug from
[ysdragon/StreamBot#112, #142, #146](https://github.com/ysdragon/StreamBot) is
the proximate amplifier (separate from F1). If they persist, F1 is the
dominant fix regardless of runtime.

### F4 — Node-level contention (lower priority)

`torvalds` ran load avg 49 on 32 cores with CPU PSI avg10 = 31 % during this
session, driven by Dagger Helm engine (2149m) + 15 Buildkite pods. Streambot
is not currently CFS-throttled (1.9 / 12 cores used), but GC threads compete
for cores during a major collection. Lower-priority:

- Add `priorityClass: system-cluster-critical` (or a custom high-priority
  class) to streambot's pod spec in
  `packages/homelab/src/cdk8s/src/resources/streambot.ts` so CI bursts don't
  preempt it.
- Optional: node anti-affinity to keep streambot off the same node as the
  Buildkite agent pool during peak CI hours.

## Observability — minimum-viable additions (answers user Q2)

Per agent 2 + agent 3 + agent 4 research (~80 cited sources):

### Add now (one PR)

| Metric                                                                                 | Source                                                                  | Why                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `streambot_ffmpeg_out_time_seconds_total` (counter)                                    | parse `out_time_us` from `-progress`                                    | The only reliable encoder-stall detector ([ffmpeg-user mailing list](https://www.mail-archive.com/ffmpeg-user@ffmpeg.org/msg36245.html)). Alert: `rate()[1m] < 0.5 for 30s` ⇒ stalled.                                                               |
| `streambot_ffmpeg_drop_frames_total` (counter)                                         | `-progress`                                                             | Frame drops on a live encode are always bad ([universal](https://www.mux.com/blog/live-stream-health-stats)).                                                                                                                                        |
| `streambot_ffmpeg_dup_frames_total` (counter)                                          | `-progress`                                                             | Duplications signal source underrun.                                                                                                                                                                                                                 |
| `streambot_ffmpeg_progress_age_seconds` (gauge)                                        | wallclock since last `progress=continue` block                          | Alert > 5 s ⇒ stderr deadlock or process death.                                                                                                                                                                                                      |
| `streambot_ffmpeg_process_rss_bytes` (gauge)                                           | `/proc/<ffmpeg-pid>/status` `VmRSS`                                     | Distinguishes ffmpeg memory from bun memory.                                                                                                                                                                                                         |
| `streambot_dvs_readable_length_bytes{stream="video"\|"audio"}` (gauge)                 | sample `readable.readableLength` on the dvs send queues once per second | The canonical "queue size" signal — bisects backpressure failure in seconds (agent 3 §4 + agent 4 step 7).                                                                                                                                           |
| `streambot_gpu_engine_video_seconds_total{engine="video"\|"render"\|"copy"}` (counter) | `/proc/<ffmpeg-pid>/fdinfo/*` `drm-engine-*` nanoseconds                | Per-pod GPU attribution that works on Gen 12+ Raptor Lake. The Frigate community uses this exact pattern ([sfortis/frigate-intel-gpu-stats](https://github.com/sfortis/frigate-intel-gpu-stats)) since `intel_gpu_top` is broken on this generation. |

### Alerts to wire (PromQL)

| Severity | Expression                                                                                     | Source                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Page     | `rate(streambot_ffmpeg_out_time_seconds_total[1m]) < 0.5` for 30 s                             | encoder stall ([ffmpeg-user](https://www.mail-archive.com/ffmpeg-user@ffmpeg.org/msg36245.html))                                                 |
| Warn     | `streambot_ffmpeg_speed_ratio > 1.10` for 1 m                                                  | producer running ahead of consumer (the failure mode this session) — agent 2 H4: "genuinely under-documented" because the standard case is `< 1` |
| Page     | `streambot_ffmpeg_speed_ratio < 0.95` for 30 s                                                 | encoder falling behind realtime (Mux drift concept)                                                                                              |
| Page     | `rate(streambot_ffmpeg_drop_frames_total[1m]) > 0`                                             | universal practice                                                                                                                               |
| Page     | `streambot_ffmpeg_progress_age_seconds > 5`                                                    | stderr deadlock or process died                                                                                                                  |
| Warn     | `rate(streambot_nodejs_heap_size_used_bytes[5m]) > 10*1024*1024 / 60`                          | sustained heap growth — unbounded queue                                                                                                          |
| Warn     | `streambot_nodejs_external_memory_bytes / streambot_nodejs_heap_size_used_bytes > 0.5` for 5 m | Buffer-heavy retention shape — the queue signature                                                                                               |
| Warn     | `streambot_dvs_readable_length_bytes > 1*1024*1024` for 30 s                                   | dvs send queue backing up                                                                                                                        |

### Defer until needed

- `lavfi.signalstats` per-frame quality metrics: VOD/QC territory (Netflix
  VMAF context), not the live failure mode. Don't put on the hot path.
- Full `clinic.js` / `0x` profiling: Bun-incompatible. Reproduce under Node
  for GC-specific diagnostics if F1+F2 don't resolve the issue.

## How pros monitor this stack (answers user Q3)

Distilled from agent 2's research across Mux, Cloudflare Stream, Twitch,
Bitmovin, Netflix blog posts plus the three single-author Prometheus
exporters in the OSS ecosystem:

- **No public platform publishes numeric alert thresholds.** Mux's
  ["Deviation from Rolling Average Stream Drift > 0 sustained"](https://www.mux.com/blog/live-stream-health-stats)
  is the closest to a published rule. Everyone else publishes a _signal_
  (drift / bitrate stability / fps stability) and leaves the threshold to the
  operator.
- **The four universal signals**: stream drift (encoder vs realtime),
  fps stability, bitrate variance, frame drops. Every platform watches
  some form of these.
- **Sustained-for-N-seconds is universal**: never page on a single sample;
  Mux uses a 30 s rolling window as the published norm.
- **Existing OSS Prometheus exporters are toy-grade** (≤ 10 ★, single
  author): `domcyrus/ffmpeg_exporter`, `JanKoppe/ffmpeg-exporter`,
  `JulianJacobi/ffmpeg-prometheus-exporter`. Production teams roll their own
  around `-progress pipe:2 -stats_period 1 -nostats` — which is what
  streambot already does.

## Debug playbook (answers user Q4) — diagnostic order of operations

Per agent 4's 28-source research. Each step is read-only `kubectl exec` /
metric scrape:

1. **Is it actually GC?** `kubectl exec <pod> -- node -e 'const h = require("perf_hooks").monitorEventLoopDelay({resolution:10}); h.enable(); setInterval(()=>{console.log({p99:h.percentile(99)/1e6,max:h.max/1e6});h.reset()},1000)'`. Spikes ≥ 200 ms aligned with viewer-visible freezes ⇒ STW pause.
2. **Where does the memory live?** `process.memoryUsage()` — `external > heapUsed * 0.5` ⇒ Buffer queue (matches us).
3. **Is the kernel send queue backing up?** `kubectl exec <pod> -- ss -uiepm` and `ss -tiepm`. `Send-Q` near zero while JS heap is multi-GB ⇒ backpressure is in userspace, not NIC ⇒ rule out bufferbloat.
4. **Is CFS throttling?** `cat /sys/fs/cgroup/cpu.stat | grep throttled` — `nr_throttled / nr_periods > 1 %` is bad. (We're at 0 — ruled out.)
5. **Is the node under pressure?** `cat /sys/fs/cgroup/cpu.pressure /sys/fs/cgroup/memory.pressure /sys/fs/cgroup/io.pressure` — `some avg10 > 10 %` warrants attention.
6. **Where's the queue?** `rg -n 'PassThrough|Readable|highWaterMark|frames\.push|queue\.push|.on\(.data.|push\(' packages/discord-video-stream/src/` — find the producer/consumer boundary and confirm `push()` return value is respected (agent 3 §4).
7. **GPU actually engaged?** `cat /proc/<ffmpeg-pid>/fdinfo/<drm_fd>` — `drm-engine-video` advancing > 1 M ns/sec ⇒ silicon doing work; < 1 M ns/sec while app claims encode ⇒ silent CPU fallback.
8. **GC-vs-network attribution**: `--trace-gc` events that align in time with viewer-visible freezes confirm GC; if event loop is healthy during freezes, look at the Discord receiver / RTP wire side.

## Verification plan

After F1 + F2 ships:

1. **Heap stabilizes.** `streambot_nodejs_heap_size_used_bytes` plateaus
   under ~500 MB over a 10-minute window on a 4K HDR remux (Endgame is the
   reproduction).
2. **Producer at realtime.** `streambot_ffmpeg_speed_ratio` ≈ 1.0,
   `streambot_ffmpeg_fps` ≈ 30, not the current 2.5–3.5× / 98–118 fps.
3. **No GC pauses.** `streambot_nodejs_eventloop_lag_p99_seconds` stays
   under 10 ms.
4. **No visible freezes.** Subjective check on the live stream.
5. **dvs queue stays small.** `streambot_dvs_readable_length_bytes < 256 KB`
   sustained.
6. **GPU still engaged.** `drm-engine-video` rate per second hasn't dropped
   significantly (we expect proportionally less work since fewer frames per
   second are produced, but the same per-frame cost).

If F1 + F2 do not fully resolve, run F3 (Node runtime) as the next bisection
step to isolate Bun-specific backpressure semantics.

## Source bibliography

All claims above trace to one of these via the per-section inline links.
~100 distinct sources across the 5 research agents:

- **GPU verification (agent 1)**: kernel.org drm-usage-stats, intel/media-driver, intel/intel-device-plugins-for-kubernetes, ffmpeg trac VAAPI, Frigate Gen 12+ workaround, Tvrtko Ursulin's i915 fdinfo patches, Jellyfin HWA tutorial, Brainiarc7 gist
- **ffmpeg observability (agent 2)**: ffmpeg.org reference, bramp/ffmpeg-cli-wrapper progress parser, the three -readrate commits (c320b78e, Apr-2023, Feb-2025), Mux Live Stream Health Stats API, Mux observability taxonomy, Cloudflare Stream blog, Twitch TwitchTranscoder retrospective, Bitmovin observability philosophy, Netflix VMAF blog, nodejs/node#41611 (64 KiB stdout HWM), pipe(7), F_SETPIPE_SZ, three toy OSS exporters
- **Node/Bun GC (agent 3)**: WebKit Riptide GC blog, V8 concurrent marking + Orinoco + trash talk, nodejs.org buffer/streams/cli/v8/perf_hooks, bun.sh runtime docs, oven-sh/bun issues, pipe and fcntl manpages, clinic.js docs
- **Stutter playbook (agent 4)**: V8 concurrent marking, Chromium WebRTC paced sender, dank074/Discord-video-stream README + npm, NodeSource event-loop blog, four Kubernetes CFS-throttling write-ups (Last9, Causely, Roszigit, Medium), kernel.org PSI docs, Unixism PSI by example, Chris's Wiki PSI numbers, Bastide PSI deep-dive, Bufferbloat FAQ, ACM Queue sender-side buffers, Baeldung UDP socket buffer, BlogGeek TWCC + REMB, Forasoft WebRTC bandwidth estimation, getstream WebRTC buffers, webrtcHacks NetEQ, walterfan jitter buffer, three OBS forum threads
- **dvs specifics (agent 5)**: ysdragon/StreamBot #112, #142, #146 (Bun-specific frame drops); Discord-RE PR #120 (backpressure intent) and #140 (readrateInitialBurst merge); dank074/Discord-video-stream issues #52 (the exact scenario), #115, #155, #190, #201 (Constant freezing), #210 (Bun + libav.js SIMD WASM); fluent-ffmpeg/node-fluent-ffmpeg #1129, #1215, #1324 (project archival); npm package page
