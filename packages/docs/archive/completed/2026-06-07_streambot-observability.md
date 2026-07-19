---
id: reference-completed-2026-06-07-streambot-observability
type: reference
status: complete
board: false
---

# Streambot Observability

## Context

Streambot transcodes local media with ffmpeg (via the vendored `@shepherdjerred/discord-video-stream`
fork) and streams it to Discord. On 2026-06-07 it hit a **playback stutter** that was nearly
impossible to diagnose: the app logs nothing while the viewer sees stutter. We ruled out OOM (fixed
via a CPU/mem bump to 12 CPU / 12Gi), resource caps, and GPU contention, but could not find the root
cause because the two decisive signals were invisible:

1. **Is the pipeline keeping realtime?** ffmpeg reports `speed=Nx`/`fps`, but the fork never surfaced
   its `progress` events. A sustained ratio < 1.0 = "will stutter once the startup buffer drains".
2. **What is the source?** A 2160p remux's HEVC 10-bit/HDR video and lossless TrueHD/DTS-HD audio
   (software-decode-only, CPU-heavy) drive the cost. There was **no ffprobe** anywhere.

Goal: make this diagnosable from Grafana in seconds. Prometheus metrics + Loki logs + a Grafana
dashboard. No OTEL tracing, no alert rules (deferred).

## What shipped

### Fork (`packages/discord-video-stream`)

Optional, backwards-compatible `StreamObserver` (`src/media/StreamObserver.ts`) threaded through the
prepare/play options. Zero behavior change when absent.

- `newApi.ts` — `command.on("start"|"codecData"|"progress")` forward to `observer` (the ffmpeg
  command line, input codec metadata, and `frames/fps/kbps/timemark` progress).
- `BaseMediaStream.ts` — emits `onSendStats({ kind, ratio, sendTime, frametime })` after the existing
  frametime-ratio computation; threaded via `VideoStream`/`AudioStream` constructors.

### streambot (`packages/streambot`)

- `src/observability/metrics.ts` — `prom-client` Registry + `Bun.serve` `/metrics`+`/healthz` on
  `METRICS_PORT` (default 9466; `0` disables). `collectDefaultMetrics({ prefix: "streambot_" })`
  gives process CPU/mem + event-loop lag.
- `src/observability/stream-observer.ts` — maps the fork's `StreamObserver` callbacks to metrics +
  logs. Derives the realtime ratio from `timemark` advance vs wall-clock (does not trust
  fluent-ffmpeg to parse `speed`). Pure helpers `parseTimemarkSeconds` / `commandUsesHardwareDecode`.
- `src/sources/probe.ts` — best-effort `ffprobe` (Zod-parsed) → logs + `streambot_source_info` gauge
  (resolution bucketed to keep cardinality low). Called from `src/sources/resolve.ts`; never blocks
  playback.
- Wiring: `index.ts` starts/stops the metrics server and emits machine-state/queue/position metrics
  via the existing `actor.subscribe`; `streamer.ts` builds the observer + segment-lifecycle and
  HW→SW-fallback metrics. Config adds `observability.metricsPort` + `ffprobePath`.

### homelab (`packages/homelab`)

- `src/cdk8s/src/resources/streambot.ts` — metrics container port 9466, headless `Service`
  (`app: streambot-metrics`), `createServiceMonitor`, `METRICS_PORT` env. Keeps the 12 CPU / 12Gi
  resource bump.
- `src/cdk8s/grafana/streambot-dashboard.ts` (grafana-foundation-sdk) — rows: Realtime health (speed
  ratio w/ 1.0 threshold, fps, event-loop lag), Send path (frametime p95, late frames), Pipeline
  (hw-decode engaged, fallbacks, segment duration), Source (`streambot_source_info`), Process
  (cpu/mem/restarts). Registered in `src/cdk8s/src/resources/grafana/index.ts`.

### Key metric

`streambot_ffmpeg_speed_ratio{hardware}` — sustained < 1.0 _is_ the stutter. The dashboard's payoff
test is replaying the 2160p remux and reading this + `streambot_source_info`.

## Verification (done)

- fork: `bun run build` + `bun run typecheck` clean; 10 tests pass.
- streambot: `bun run typecheck` clean; `eslint` clean; 135 tests pass (incl. new probe/observer/
  metrics tests).
- homelab: `bun run typecheck` clean; `bun run build` (cdk8s synth) renders the Service +
  ServiceMonitor + dashboard ConfigMap + container port 9466 + 12/12 resources.

## Post-merge verification (TODO)

- ArgoCD sync `media`; `kubectl -n media port-forward deploy/media-streambot 9466:9466` →
  `curl localhost:9466/metrics` shows `streambot_*`.
- Open the streambot Grafana dashboard; replay the 2160p remux and confirm `streambot_source_info`
  shows the real codecs and whether `streambot_ffmpeg_speed_ratio` sits below 1.0 while stuttering.

## Out of scope

OTEL tracing/Tempo; Prometheus alert rules (sustained `speed<1`, OOM, HW fallback) — revisit once the
dashboard has real baselines.

## Session Log — 2026-06-07

### Done

- Diagnosed the streambot crash loop as `OOMKilled`; bumped resources to 12 CPU / 12Gi (live patch +
  committed in `streambot.ts`). Stutter shown to be CPU/realtime-bound, not GPU contention.
- Killed the idle `mk64-spike/mk64-gpu` GPU-holder pod (freed the shared iGPU slot).
- Implemented the full observability stack above (fork + streambot + homelab). All checks green.

### Remaining

- Open the PR; after merge run the post-merge verification above.
- ~~Drop the now-empty `mk64-spike` namespace.~~ **Done 2026-06-27** (`kubectl delete namespace
mk64-spike`) as part of the cdk8s-untracked-resource cleanup — see
  `packages/docs/logs/2026-06-27_k8s-cdk8s-untracked-audit.md`.

### Caveats

- streambot resolves the fork via its built `dist/*.d.ts` (skipLibCheck) — a fresh worktree must
  build the fork (`bun run build` in `packages/discord-video-stream`) BEFORE typechecking streambot,
  or tsc falls back to fork source under the stricter config and reports spurious errors.
- `streambot_ffmpeg_speed_ratio` reflects raw transcode throughput (ffmpeg is not readrate-limited):
  > 1.0 early while the buffer fills, settling near the sustainable rate. Read it together with the
  > send-path frametime ratio to tell transcode-bound from send-bound stutter.
