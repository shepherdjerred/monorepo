# MK64 unplayable input lag (~20s) — root cause & fix

## Status

Complete — shipped in PR #1274. Worker-thread follow-up deferred (todos/mk64-emulator-worker-thread.md).

## Context

In the week before 2026-06-19, Discord Plays Mario Kart 64 became unplayable: ~20s of
input lag even for a single player, can't reach the start screen. The user wants to
**keep hardware (VAAPI) encoding** on the Intel iGPU.

Diagnosed live against prod (Grafana/Prometheus + pod logs + in-pod ffmpeg benchmarks).
Headline: **the encoder is not the bottleneck.** The pipeline starves ffmpeg on the
single Node event loop and then lets latency grow without bound.

## Evidence (measured)

| Observation                                                                                      | Source          | Verdict                                                |
| ------------------------------------------------------------------------------------------------ | --------------- | ------------------------------------------------------ |
| Emulator ticks ~30/s; `emulate_ms` p95 ≈ **30ms** (33ms budget)                                  | Prometheus      | Emulator eats ~90% of the one Node thread              |
| `stream_sink_buffer_bytes` hit **3.47 GB** (≈5,650 frames ≈ **188s**)                            | Prometheus      | Frames buffer **unbounded** — this _is_ the lag        |
| Live session `speedRatio` **0.56–0.58**, 125 consecutive slow samples                            | pod logs        | ffmpeg <realtime in prod                               |
| Session summary: pushed 3265 vs sent 2942 frames / 112s                                          | pod logs        | ~14–20s lag accrues in ~2 min                          |
| In-pod benchmark, **current** VAAPI cfg 720p: **16.7× realtime (500fps)**; tuned variants 16–18× | `ffmpeg` in pod | iGPU + settings have huge headroom                     |
| Prod-faithful (realtime feed + audio + libopus): VAAPI **1.02×**, libx264 **1.02×**              | `ffmpeg` in pod | **Encoder exonerated** — both fine standalone          |
| `pushFrame` = unconditional `frameSink.write` (no drop), always                                  | code            | Latent flaw: slow consumer → runaway queue             |
| `streamer destroy failed: this.connection.readyState` null on `/stop`                            | pod logs        | Teardown throws → leaks voice/ffmpeg per `/play`       |
| Pod CPU during session idle (426m / 8000m), 0 throttling                                         | `kubectl top`   | Not CPU-quota starved → it's **event-loop** starvation |

**What changed:** `#1251` (on-demand `/play`, Jun 15) added `mario-kart-driver.ts`
`hardwareAcceleration: Bun.env.STREAM_HARDWARE_ACCELERATION === "true" || …`, which first
honored the chart's `STREAM_HARDWARE_ACCELERATION=true` (set Jun 7 but ignored by the old
code) and flipped libx264→VAAPI. Benchmarks prove the encoder swap is **not** the cause —
the true root cause (single-thread saturation + unbounded buffer) is older and was flagged
in `2026-06-13_mk64-perf-test.md`.

## Root cause

The emulator's synchronous ~30ms `runMainLoop` runs on the **same Node event loop** as the
Discord stream I/O (BGRA → ffmpeg stdin @ ~18 MB/s, drain stdout, RTP send). With ~3ms/frame
left, ffmpeg is starved (reads/drains < 30fps) even though it can encode >realtime. With no
backpressure/drop in `pushFrame`, the deficit accumulates into a multi-GB / multi-minute
queue → ~20s input lag and OOM risk (3.5 GB vs 4 GB pod limit).

## Implemented (this PR — keep VAAPI)

1. **Bounded frame queue (drop stale, keep latest)** — `stream/game-streamer.ts` `pushFrame`:
   drop the newest frame once `frameSink.writableLength ≥ MAX_SINK_BUFFER_BYTES` (~3 frames,
   ~100 ms). Bounds end-to-end input lag and removes the OOM risk regardless of why the
   consumer is slow. New `stream_frames_dropped_total` metric + `framesDropped` in the
   session summary. Decision predicate extracted as `shouldDropFrame()` and unit-tested.
2. **Teardown leak fix** — `game-streamer.ts` `destroy()`: guard `streamer.client.destroy()`
   so the selfbot's null-`connection` throw can't abort session teardown and orphan
   voice/ffmpeg/GPU handles across `/play` cycles.
3. **Per-frame allocation trim** — `n64-emulator.ts` `seatActivity()`: drop the per-seat
   `slice()`/`Object.values()` allocations (runs every frame on the saturated thread).

Kept `-framerate 30` for the rawvideo input (did **not** switch to wall-clock timestamps):
the drop policy bounds the _input lag_ — the actual complaint — on its own. Under sustained
drops there can be minor A/V drift; acceptable and minimized once the event loop has headroom.

## Deferred (follow-up — see `todos/mk64-emulator-worker-thread.md`)

- The drop policy makes it **playable** (low latency) but, while the event loop is saturated,
  output frame rate stays at whatever Node can sustain (~17–20fps), not 30. Restoring 30fps
  needs the emulator (`runMainLoop`) moved to a **Worker thread** so the main loop is free for
  stream I/O. Do this only if post-deploy measurement shows fps still short under load.

## Verification

- ✅ `bun run typecheck`, `bun run test` (120 pass), `bunx eslint .` (clean) in the backend.
- ✅ Unit test: `shouldDropFrame` boundaries + a stalled-consumer PassThrough stays bounded.
- ⏳ **Post-deploy (waiting):** during a real `/play`, Grafana `stream_sink_buffer_bytes`
  stays near 0 (≤ a few frames), `stream_frames_dropped_total` rises only under load,
  controller→screen lag is ~sub-second, A/V acceptable. The `e2e:perf` harness drives the
  emulator path only (empty `onFrame`), so it can't validate the stream sink locally.

## Files

- `packages/discord-plays-mario-kart/packages/backend/src/stream/game-streamer.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/stream/stream-observer.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/observability/metrics.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/emulator/n64-emulator.ts`
- `packages/discord-plays-mario-kart/packages/backend/src/stream/game-streamer.test.ts` (new)

## Session Log — 2026-06-19

### Done

- Diagnosed the regression end-to-end against prod (Grafana/Prometheus, pod logs, in-pod
  ffmpeg benchmarks). Confirmed: emulator healthy (~30 ticks/s), encoder healthy
  (VAAPI 16.7× standalone / 1.02× realtime-fed), bottleneck = single-thread starvation +
  unbounded frame queue (3.47 GB / ~188s backlog).
- Implemented the fix on `feature/mk64-stream-backpressure` (PR #1274): bounded frame
  queue + `stream_frames_dropped_total` + `shouldDropFrame()` unit test; `destroy()` leak
  guard; `seatActivity()` allocation trim.
- Green locally: `bun run typecheck`, `bun run test` (120 pass), `bunx eslint .`.

### Remaining

- **Post-deploy verification (waiting):** after PR #1274 ships, watch a real `/play` — Grafana
  `stream_sink_buffer_bytes` near 0, `stream_frames_dropped_total` rising only under load,
  controller→screen lag ~sub-second, A/V acceptable.
- **Conditional follow-up:** if delivered fps still sits well below 30 under load, move the
  emulator to a Worker thread — `todos/mk64-emulator-worker-thread.md`.

### Caveats

- Kept `-framerate 30`; under _sustained_ frame drops there can be minor A/V drift. The drop
  policy still bounds the input lag (the reported symptom); drift is minimized once the event
  loop regains headroom (worker-thread follow-up).
- The `e2e:perf` harness can't validate the stream sink locally (it registers an empty
  `onFrame`), and the wasm isn't built in the worktree — so the stream-path validation is
  the post-deploy step above, covered by the new unit test for the drop logic itself.
