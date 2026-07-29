---
id: log-2026-07-28-mk64-runtime-performance-followup
type: log
status: complete
board: false
---

# MK64 Runtime and Performance Follow-up

## Request

Repair the live Mario Kart 64 startup failure
`emscripten export missing or not callable: _malloc` and investigate why the
Worker-thread performance change did not improve the delivered stream.

## Findings

- The live workload is Kubernetes-healthy but the application path is not:
  - Argo CD reports `Synced` / `Healthy`.
  - The current pod is Ready with zero restarts.
  - The 2026-07-29 01:11:24 UTC `/play` attempt failed in emulator
    initialization because `Module._malloc` is absent.
- The generated WASM build contract does not export `_malloc`, although
  `N64Emulator.init()` requires it to inject the ROM.
- The ROM-free Worker smoke validates only `_runMainLoop`, `callMain`, and
  `FS.writeFile`, so it does not exercise the complete production runtime
  facade and allowed the broken image to pass.
- The last successful Worker-enabled production session (pod revision 78,
  2026-07-28 00:31–00:34 UTC) confirms the performance report:
  - emulator tick rate stabilized at 30 ticks/s;
  - main-thread event-loop p99 was roughly 1.5–4.3 ms;
  - VAAPI hardware encoding was engaged;
  - ffmpeg output was 16–20 fps and roughly 0.36–0.56x realtime;
  - the frame gate dropped about 15 frames/s;
  - session summary: 14.9 pushed fps, 50.2% dropped, zero late video sends.
- `_runMainLoop` advances one 60 Hz N64 vertical interrupt, while the host
  invoked it once per 30 Hz output frame. This ran the game and audio clocks at
  half speed: ffmpeg waited for its declared 44.1 kHz audio input while video
  queued and was dropped.
- Running both VI steps back-to-back at 30 Hz restored audio time but created
  24–60 ms CPU bursts that missed the 33 ms video deadline. The correct model is
  one core step every 16.7 ms, audio drain after every step, and video emission
  after every second step.

## Session Log — 2026-07-28

### Done

- Confirmed the live `_malloc` failure from current Kubernetes logs.
- Located the missing Emscripten export and the incomplete smoke contract.
- Reconstructed the Worker-enabled production session from Prometheus and Loki
  and independently confirmed that delivered frame rate did not improve.
- Exported `_malloc` and `HEAPU8` and made the ROM-free smoke validate the full
  Emscripten module/filesystem facade used by production.
- Paced the core at 60 VI ticks/s while preserving 30 output frames/s, with
  focused tests for the cadence.
- Added a ROM-backed assertion that PCM duration tracks emulated game time.
- Verified the generated runtime smoke, a five-second Worker run, and the
  real-emulator audio path:
  - 150 Worker frames in five seconds, with 252 audio chunks;
  - 39.15 seconds of PCM for 40.00 seconds of game time (`0.979x`);
  - non-silent Opus round-trip through the production stream pipeline.
- Verified the worst local performance scenario (four seats plus controller
  spam): 29.99 fps, 25 ms emulation p95, 0 ms late p95, zero resyncs, and 16 ms
  input-apply p95.
- Verified every ROM-backed performance scenario on the current commit:
  - one player idle: 29.98 fps, 25 ms emulation p95, zero resyncs;
  - four players idle (isolated rerun): 30.00 fps, 25 ms emulation p95, zero
    resyncs;
  - one player plus controller spam: 29.99 fps, 25 ms emulation p95, zero
    resyncs, 16 ms input-apply p95;
  - four players plus controller spam: 30.00 fps, 25 ms emulation p95, zero
    resyncs, 16 ms input-apply p95.
- Passed backend/scripts typecheck, unit tests, and lint (127 backend tests and
  16 build-script tests).
- Built `discord-plays-mario-kart:dev` from the production Dockerfile and passed
  both the in-image WASM contract smoke and the real entrypoint smoke. The final
  image applies each Emscripten patch exactly, without patch fuzz.
- Matched Worker audio backpressure to the 60 Hz drain cadence: six audio
  chunks now cover the same jitter window as three 30 fps video frames.
- Made the audio e2e fail immediately if ffmpeg exits while video input is
  waiting for backpressure to drain.
- Published PR #1779 and promoted it to ready for review.
- Built commit `0c8cc45db8f12f0f1a0d74f1d3cce1ff74f90939` with the
  repository's production Bake target and published the immutable amd64
  candidate
  `ghcr.io/shepherdjerred/discord-plays-mario-kart:pr-1779-0c8cc45db@sha256:2a75f7c826009c9714f53c13f69fbcfe4ccef655208a1c9ae54bcb452099ea36`.
- Temporarily paused automated sync for the `mario-kart` Argo CD Application,
  deployed the candidate by digest, and verified that the Ready pod reported
  `serviceVersion=pr-1779`.
- Reproduced the formerly failing `/play` path through Discord:
  - the ROM opened and the emulator logged `n64 emulator booted`;
  - the session reached the `streaming` state;
  - ffmpeg started with VAAPI;
  - no `_malloc` or other Emscripten export error occurred.
- Ran the production browser performance harness against the live candidate
  with four claimed seats and controller spam. Over the 30-second measurement:
  - emulator rate was 29.03 fps with 25 ms emulation p95 and zero resyncs;
  - ffmpeg held 30.04 fps and `0.9997x` mean realtime speed;
  - VAAPI remained engaged;
  - the stream sink stayed at zero buffered bytes;
  - video and audio recorded zero late sends.
- Stopped the Discord session, restored the exact declared production image,
  re-enabled Argo CD automated sync, and confirmed the Application returned to
  `Synced` / `Healthy`.
- Removed the two temporary image-publisher Jobs, stopped the temporary
  PinchTab and Discord sessions, and closed both Kubernetes port-forwards.

### Remaining

- Fix the separate Worker teardown ordering error found when `/stop` ended the
  successful test session. It is tracked in
  [`mk64-worker-session-stop-reset-order`](../todos/mk64-worker-session-stop-reset-order.md).

### Caveats

- The ROM-gated checks require the canonical local MK64 ROM and cannot run in
  CI.
- One combined performance run overlapped workstation load above 20 and its
  four-player idle window fell to 21.88 fps. The identical scenario passed at
  30.00 fps on an immediate isolated rerun; no user processes were stopped.
- The live harness's built-in 4-player menu navigation exceeded PinchTab's eval
  timeout. Its supported `--skip-nav` mode completed the same four-seat input,
  emulator, ffmpeg, and send-path load measurement without requiring the
  long-running browser evaluation.
- The live result is near realtime rather than cadence-flat: loop lateness p95
  was 16 ms and stream frame-interval p95 was 50 ms. It nevertheless removed
  the prior half-speed behavior, sustained 30 fps ffmpeg output at `1.0x`, and
  accumulated no sink backlog or late sends.
- `/stop` completed and the stream shut down, but its asynchronous session-end
  callback ran after `WorkerEmulator.stop()` and logged
  `emulator worker is not running`. That distinct lifecycle defect is now
  tracked separately.

## Workflow Friction

- The `monorepo-docs` skill says to run `bun run check-docs`, but the root
  `package.json` has no `check-docs` script. The supported root command is
  `bun run check-todos`, which invokes
  `packages/docs-board/src/cli/check-docs.ts` and validates the full docs model.
