---
id: mk64-emulator-worker-thread-plan
type: plan
status: complete
board: false
---

# MK64: move the emulator to a Worker thread (fix stream stutter + input lag)

Implements `packages/docs/todos/mk64-emulator-worker-thread.md`. Its acceptance
check ran during a real session on 2026-07-26 and **failed** → build the worker.

## Root cause (measured, 2026-07-26 session 21:16–21:19 UTC)

- Emulator produced 4085 frames / 136s = **30fps — emulation keeps up**.
- ffmpeg pipeline delivered **14.9fps** (`stream_ffmpeg_speed_ratio` 0.54–0.56);
  **50.3% of frames dropped** at the 3-frame sink gate (`MAX_SINK_BUFFER_BYTES`).
- Per-frame latency attribution: emulate 12.1ms avg (p95 ~30ms of the 33ms
  budget), copy 0.19ms, sink write 0.05ms, input apply delay 12.5ms, controller
  RTT 16.3ms, **event-loop p99 25.8ms**.
- Not resources: container 0.35/8 cores, 556Mi/4Gi, VAAPI engaged, encoder
  benchmarks ~16.7× realtime standalone, iGPU shared with 4 other pods but far
  from saturated.

The synchronous wasm `runMainLoop` shares one JS event loop with ALL stream I/O
(ffmpeg stdout drain → nut demux → RTP packetize → UDP send, plus socket.io,
Discord gateway, overlay compositing). Stream I/O starves → ffmpeg blocks on
stdout backpressure → sink queue fills → frames dropped. Single-threaded
emulation can't be separated from stream I/O while both live on one loop.

## Design

Move `N64Emulator` (wasm host, tick loop, input latching, audio drain, RDRAM,
MEMFS/save persistence) into a **Bun Worker**. Main thread keeps: streamer
(ffmpeg/Discord I/O), overlay compositing, seat manager, web dispatch, race
watcher/store, Prisma.

### New files (`packages/backend/src/emulator/worker/`)

- `protocol.ts` — typed request/event messages (zod-free; plain TS unions +
  runtime guards at the boundary).
- `emulator-worker.ts` — worker entrypoint: constructs `N64Emulator`, wires
  callbacks → `postMessage` (frames/audio/snapshots as transferable buffers),
  executes commands.
- `worker-emulator.ts` — main-thread facade with the same surface the driver
  needs; spawns the worker, request/response for `init`/`renderFrame`/
  `persistSaves`, fire-and-forget for inputs/start/stop/restart.
- `metric-bridge.ts` — worker-side batching `MetricSink` (arrays flushed ~1/s);
  main side replays into the existing prom instruments (identical metric
  names/semantics; `/metrics` stays main-thread).

### `N64Emulator` changes (minimal, harness-compatible)

- Metric calls go through an injectable `MetricSink`; default = current
  prom-client instruments (e2e harnesses unchanged).
- No other behavior change; tick loop, input latching, save persistence stay.

### Main-thread rewiring

- **Driver**: construct facade; `onFrame(({rgba, height, seatActivity})` →
  overlay (uses per-frame `seatActivity` + height from the message) →
  `pushFrame`; overlay context closes over latest frame meta.
- **RaceTracker**: drop `emulator` dep + `onFrame()` polling; worker reads
  `readSnapshot` from RDRAM every `pollEveryNFrames` and posts the small
  decoded snapshot; `RaceTracker.updateFromSnapshot(snap)` feeds watcher +
  persists (pure `RaceWatcher` unchanged).
- **dispatch.ts / /screenshot**: `renderFrame()` → `Promise<frame>` (request/
  response with id); handlers go async.
- `seatActivity()`/`height` main-thread getters → served from latest frame
  message.

### Protocol messages

Main→Worker: `init(opts)` (wasmDir/romPath/fps/software/seats/savesDir/
pollEveryNFrames), `start`, `stop`, `restartFromStartMenu(reason)`,
`setPlayerInput(seat,state)`, `clearPlayerInput(seat)`,
`renderFrame(id)`, `persistSaves(id)`, `shutdown`.
Worker→Main: `ready`, `frame{rgba,height,seatActivity}` (transfer),
`audio{pcm}` (transfer), `snapshot{snap}`, `metrics{batch}`,
`renderFrameResult{id,rgba,width,height}` (transfer), `persistSavesResult{id}`,
`error{message,stack}`.

### Risks

- **Emscripten env detection in a worker**: glue must keep detecting
  ENVIRONMENT_IS_NODE (wasm-host.ts forbids `window`; NODE branch needs
  `process` — present in Bun workers). If `importScripts` flips WORKER
  detection and breaks FS, `Reflect.deleteProperty(globalThis,
"importScripts")` before eval. Verified empirically via the e2e harness
  against the worker path.
- Frame/audio transfer: `Buffer.from()` copies are dedicated ArrayBuffers →
  zero-copy `postMessage` transfer.
- Ordering: port FIFO preserves input-before-tick semantics; inputs apply at
  next tick boundary exactly as today.

## Verification

1. Unit: update dispatch (async renderFrame) + race-tracker tests; add
   metric-bridge batch/replay + protocol guard tests.
2. Integration (local, ROM-gated): `bun run build:wasm` (Docker, minutes), new
   `scripts/e2e-worker.ts` boots the facade with real wasm+ROM ~30s: ticks ≈
   30/s, frames flowing, screenshot advances with input, metrics flush arrives.
3. `bunx turbo run typecheck test lint --filter` the touched packages.
4. Post-deploy (human/agent): `/play` session → `stream_ffmpeg_fps` ≈ 30,
   `stream_frames_dropped_total` ≈ 0, `emulator_input_apply_delay_ms` flat.
   Then archive `todos/mk64-emulator-worker-thread.md` as complete.

## Historical follow-up state

- Land the PR (draft → ready after review, then merge).
- Post-deploy measurement on a live `/play` session: `stream_ffmpeg_fps` ≈
  30, `stream_frames_dropped_total` ≈ 0, `emulator_input_apply_delay_ms`
  flat. Then archive `todos/mk64-emulator-worker-thread.md` as complete.
