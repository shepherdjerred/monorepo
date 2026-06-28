---
id: mk64-emulator-worker-thread
status: waiting-on-verification
origin: packages/docs/archive/completed/2026-06-19_mk64-stream-backpressure.md
source_marker: false
---

# MK64: move the emulator to a Worker thread to restore 30fps

## Why

The stream-backpressure fix (2026-06-19) bounds input lag by dropping stale frames, so MK64
is **playable** again (low latency). But the root cause is that the emulator's synchronous
~30ms `runMainLoop` runs on the **same Node event loop** as the Discord stream I/O (feeding
ffmpeg stdin, draining its stdout, RTP send). With the emulator consuming ~90% of each 33ms
frame, the stream I/O is starved, so under the new drop policy the broadcast frame rate sits
at whatever Node can sustain (~17–20fps) rather than 30 — low-latency but choppy.

Benchmarks proved the encoder (VAAPI **and** libx264) does >realtime standalone — the
bottleneck is purely the single JS thread. This was first flagged in
`packages/docs/plans/2026-06-13_mk64-perf-test.md` as "Step 3: worker-thread the emulator".

## Acceptance check first (this is why status = waiting-on-verification)

After the backpressure PR deploys, measure during a real multiplayer `/play`:

- `rate(emulator_ticks_total{namespace="mario-kart"}[1m])` — emulate tick rate
- `stream_ffmpeg_fps` / `stream_frames_dropped_total` — delivered fps vs drops
- `stream_sink_buffer_bytes` — should stay near 0

If delivered fps holds ~28–30 under load, **close this todo (resolved)** — no worker needed.
If it stays well below 30 (sustained drops), do the work below.

## Work (only if the check fails)

- Move `N64Emulator.runMainLoop` + the wasm core onto a `Worker` (`node:worker_threads`),
  posting captured BGRA frames (transferable `ArrayBuffer`) back to the main thread, which
  keeps overlay compositing + `pushFrame` + RTP send. Keep input application ordering
  (PATCHES.md: latch before the per-frame `resetNeilButtons`).
- Re-validate with the `e2e:perf` harness and live Grafana.

## Related

- `packages/docs/plans/2026-06-19_mk64-stream-backpressure.md`
- `packages/docs/plans/2026-06-13_mk64-perf-test.md`
