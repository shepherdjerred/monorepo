---
id: mario-kart-session-check
type: log
status: complete
board: false
---

# Mario Kart (discord-plays-mario-kart) session check — 2026-07-26

User played a Mario Kart 64 session on the k8s deployment; checked pod logs
and Prometheus metrics afterward.

## Findings

- Session ran 21:16:51–21:19:08 UTC (136s), guild `1337623164146155593`, ended
  via `userStop`. Pod `mario-kart-b5c5dd7cc-xmnpj` healthy, 0 restarts.
- **Stream quality was poor**: session summary reported `pushedFps: 14.9`
  (target 30), `droppedPct: 50.3` (2055 dropped / 2030 pushed),
  `lastSpeedRatio: 0.54`. Repeated `ffmpeg encode running below realtime`
  warnings (125 consecutive slow samples, ratio ~0.56).
- HW encode engaged (`h264_vaapi`, `/dev/dri/renderD128`, i915 GPU).
- Metrics during the session (21:16–21:19 UTC window):
  - `rate(emulator_ticks_total)` ≈ **17.6/s vs 30 target** — the emulator loop
    itself couldn't keep up.
  - `stream_ffmpeg_speed_ratio` ≈ 0.37–0.56, `stream_ffmpeg_fps` ≈ 14.
  - Container CPU ≈ 0.35 cores (limit 8), memory 556Mi (limit 4Gi) — **not**
    resource-limited; bottleneck is the single-threaded emulate+encode loop,
    not cgroup throttling.
- Save state persisted cleanly; emulator auto-restarted after the session as
  designed. One benign warn on stop: `selfbot client destroy failed (ignored)`.
- `stream_send_late_frames_total` had no samples (metric present but no data).

## Session Log — 2026-07-26

### Done

- Inspected mario-kart pod logs and queried Prometheus
  (`emulator_ticks_total`, `stream_ffmpeg_speed_ratio`, `stream_ffmpeg_fps`,
  container CPU) for the session window; reported stream-health diagnosis.

### Remaining

- None requested. If stream quality matters: emulator running ~60% of target
  tick rate with CPU headroom suggests per-frame cost (parallel-n64 cached
  interpreter + vaapi upload) rather than scheduling — worth profiling the
  emulate+send loop.

### Caveats

- `process_cpu_seconds_total` only covers the Node process; used
  `container_cpu_usage_seconds_total` for the whole-container figure (same
  ~0.35 cores, so ffmpeg is not CPU-bound either — likely frame-starved by the
  slow emulator).
