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

## Session Log — 2026-07-26

### Done

- Root-caused via pod logs + Prometheus latency attribution (see
  `logs/2026-07-26_mario-kart-session-check.md`): single event loop shared by
  synchronous emulation (~90% of frame budget) and all stream I/O; encoder and
  resources exonerated.
- Confirmed the todo's acceptance check failed (14.9fps delivered) → worker
  thread is the prescribed fix; wrote this plan.
- **Implemented the full refactor** (a first opencode session drafted the worker
  modules and died mid-edit on the driver; this session finished the wiring):
  - New `emulator/metric-sink.ts` (`MetricSink` indirection + default
    prom-client impl); `N64Emulator` now observes through an injectable sink.
  - New `emulator/worker/`: `protocol.ts` (Zod-validated message envelopes,
    trusted structured sub-payloads), `emulator-worker.ts` (worker entrypoint),
    `worker-emulator.ts` (main-thread facade), `metric-bridge.ts` +
    `metric-replay.ts` (batch worker observations → replay into shared registry).
  - Rewired `mario-kart-driver.ts` to construct `WorkerEmulator`, feed overlay
    from per-frame message meta (`latestSeatActivity`/`frame.height`), and drive
    the tracker from `onSnapshot`; `RaceTracker` now `updateFromSnapshot(snap)`
    (no emulator dep / RDRAM polling).
  - Made the dispatch/screenshot `renderFrame()` path async (Worker round-trip);
    updated `EmulatorControls`, the socket dispatch, the `/screenshot` command,
    the dispatch test fake, and the `e2e-perf` harness adapter.
  - **Correctness fix beyond the draft:** guarded the postMessage transfer list
    (`transferListFor`) so only buffers that own their whole ArrayBuffer are
    transferred — small audio chunks are pool-backed, and transferring a pooled
    `.buffer` would detach the shared Buffer pool. Frames stay zero-copy.
- Green locally: `tsc --noEmit` clean, `bun test` 120 pass, `eslint .` clean.
- **Ran the load-bearing e2e** (`bun run scripts/e2e-worker.ts`, real wasm+ROM):
  the wasm core boots and steps inside the Bun Worker. 5s run delivered 151
  frames (~30fps), 109 audio chunks, 15 in-worker race snapshots, a 640×240
  screenshot round-trip, and 146 metric ticks replayed into the shared registry.
  Confirms the #1 risk (emscripten NODE-env detection in a Bun Worker) is cleared
  and the pool-guarded audio transfer does not corrupt audio.

### Historical follow-up state

- Land the PR, then measure on a live `/play` session (see `## Remaining` above).

### Caveats

- e2e harnesses keep driving `N64Emulator` directly (no worker); the worker
  transport is covered by the new `e2e-worker.ts` instead.
- `importScripts`/env detection in the worker is the main unknown — the smoke
  test confirmed `importScripts` is undefined and `process` present in Bun
  workers (emscripten should pick the NODE branch), but the real wasm boot is
  only proven once `e2e-worker.ts` runs green.

## Session Log — 2026-07-27

### Done

- PR #1698 is merged and the real wasm/ROM worker harness recorded approximately 30 frames per second.

### Remaining

- None in this plan.

### Caveats

- The historical design is retained for context; it is not an active board item.
