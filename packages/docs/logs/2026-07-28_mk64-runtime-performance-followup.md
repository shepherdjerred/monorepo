---
id: log-2026-07-28-mk64-runtime-performance-followup
type: log
status: in-progress
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
- Manual acceptance exposed a content-sync gap hidden by the prior telemetry:
  the live candidate dropped 148 raw-video frames while forwarding continuous
  PCM. Because ffmpeg assigns consecutive 30 fps timestamps only to frames that
  reach its rawvideo pipe, video-only drops compress the video content timeline
  while audio content keeps advancing. The sender can remain at `1.0x` with
  matching audio/video packet durations after that fixed offset has accumulated.

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
- Re-deployed the immutable PR candidate for manual acceptance and reproduced
  the reported audio delay with 148 video-only drops accumulated during the
  live session.
- Published and deployed the first audio-sync candidate from commit
  `52a59c11471fb4af0e0490dd322d1ebcac9e4283`. Live telemetry rejected it:
  pairing startup frame drops with withheld PCM starved ffmpeg's second input,
  held progress at zero, and produced 942 additional frame drops. Rolled the
  pod back immediately and restored the known-good 30 fps candidate.
- Replaced paired media dropping with whole-emulator flow control. The ffmpeg
  raw-video `PassThrough` now has a three-frame high-water mark; when `write()`
  signals backpressure, the Worker tick loop pauses (stopping game, video, and
  audio time together) and resumes on `drain`. This retains a bounded media
  queue without compressing one content timeline or starving either input.
- Added validated Worker `pause` / `resume` protocol commands, current-state
  and cumulative backpressure metrics, and tests proving the stalled sink
  remains bounded and emits `drain` when consumption resumes.
- Passed the revised backend suite: 127 tests, typecheck, and lint.
- Published and deployed the flow-control candidate from commit
  `6f907702e32a45683b89790325b23cdacfbd1e71`. It bounded the queue and
  preserved both inputs, but the single startup pause did not drain: ffmpeg
  remained at zero progress. Rolled back to the known-good candidate again.
- Traced the startup wall to command construction in `discord-video-stream`:
  `-fflags nobuffer -analyzeduration 0` were output after both `-i` arguments,
  so neither live raw input received them and ffmpeg retained its default probe
  behavior. The options now bind before each input, including the separate PCM
  socket.
- Added an argument-order regression test that requires one low-latency option
  set before each `-i`; passed all 60 `discord-video-stream` tests plus the 127
  backend tests, typecheck, and backend lint.
- Published and deployed commit
  `36495b83e2ede69b497b03c54afcd7d8a08cd5df`. The corrected option
  placement was visible in the live command, but ffmpeg still consumed the
  short synchronized pre-roll and polled for more audio while the video sink
  remained backpressured. `/proc` confirmed an empty PCM socket receive queue
  and a polling ffmpeg process.
- Added `-probesize 32` (ffmpeg's minimum legal value) only to the two inputs
  whose formats are fully declared: raw BGRA video and the shared raw-PCM audio
  transport. This avoids weakening format discovery for container, HLS, or
  other generic `minimizeLatency` callers.
- Passed all 60 `discord-video-stream`, 9 `discord-plays-core`, and 127 MK64
  backend tests plus typecheck and the configured package lint gates.
- Reproduced the pause/resume boundary outside Discord with the real ffmpeg
  process. Six frames plus 200 ms of PCM drained in about 107 ms, proving the
  command and flow-control path work once audio exists. This isolated the
  live-only difference: N64 boot emits video before its audio ring is primed,
  so the initial backpressure pause occurred before ffmpeg had usable PCM.
- Delayed the first whole-emulator pause until one second (176,400 bytes) of
  stereo s16le PCM has actually been forwarded. A video-first harness (ten
  frames before audio) then buffered 40 frames / 22,732,800 writable bytes and
  drained in about 34 ms once paused, without dropping either content stream.
- Added focused tests for the audio-pre-roll gate and passed the affected
  typecheck and lint targets.
- Published and deployed the audio-pre-roll candidate from commit
  `129aab491d9f97fa7dc51ab8d7cbb29bf784f20d`. It crossed the prior
  startup wall with zero dropped frames and nonzero ffmpeg progress, but the
  emulator remained paused after ffmpeg consumed the pre-roll. That prevented
  new PCM from arriving before the initial video queue could emit `drain`.
- Replaced the startup-only drain dependency with explicit encoder flow state:
  the first ffmpeg progress event proves that both inputs are initialized and
  releases the startup pause; the existing drain listener then re-arms normal
  steady-state pause-on-backpressure behavior after the startup queue catches
  up. Later progress events cannot release a steady-state pause.
- Added state-transition tests covering the PCM gate, first-progress release,
  drain re-arm, steady-state drain release, and reset behavior.
- Published and deployed commit
  `88d9994eed5a9d6c3675bdc1826a40932cfc1348`. The live run exposed an
  event-order edge: ffmpeg reported progress before the one-second PCM gate
  allowed the emulator to pause. The callback was consumed too early, so the
  later pause still waited only for `drain`; telemetry showed zero drops and
  nonzero ffmpeg progress but `stream_emulator_paused 1`. The candidate was
  stopped and the known-good stream restored.
- Made the initial full-sink event install its single drain watcher even before
  the PCM gate. Encoder progress now applies the startup bypass only while that
  queue is outstanding, whether the PCM gate has paused the emulator yet or
  not. This preserves the bypass across the observed live event order, while a
  queue that already drained uses normal steady-state control.
- Published and deployed commit
  `b7863c01cd2ba8a72063743e1b5a59a8ecce26b9`. It released the first
  startup pause, but the next ordinary three-frame backpressure pause stalled
  the dual-input encoder again. Live telemetry showed two pauses, zero drops,
  nonzero ffmpeg progress, and `stream_emulator_paused 1`. This rejected
  whole-emulator pause/resume as the steady-state control mechanism, not merely
  its startup event ordering.
- Removed the pause/resume Worker protocol, callback plumbing, state machine,
  and pause telemetry. Emulator production now starts only after the ffmpeg
  process and both raw transports exist, preventing gameplay media from
  accumulating during encoder setup.
- Replaced the three-frame drop/pause queue with an eight-second hard-bounded
  burst buffer. It retains the complete A/V content timeline across the
  measured 149-frame startup wall; if the encoder ever exceeds 240 frames of
  buffered video, the stream fails loudly instead of dropping only video or
  growing toward the previously observed multi-gigabyte backlog.
- Published and deployed commit
  `92d835746b5c755ffe7691ec29cd7242e6acef79` as immutable image
  `sha256:b714d7c32866142e3457daa820d681731508c994ea3a01ed3f64ac05010d0929`.
  The live stream reached 31.27 ffmpeg fps with zero frame drops, no restarts,
  and an 18-frame startup queue against the 240-frame hard limit.
- Argo CD restored the declared production image during the first acceptance
  run. Added the temporary `argocd.argoproj.io/skip-reconcile=true` hold,
  explicitly disabled child-Application automated sync, redeployed the same
  digest, and restarted `/play` for manual listening.
- Buildkite build 6860 found the removed drop counter as an unused export in
  Knip. Replaced it with a hard-buffer-failure counter that is incremented by
  the actual fail-fast path; focused tests, typecheck, lint, and Knip pass.
- Manual listening confirmed that audio timing was correct, but video lagged by
  about one second. Live telemetry independently showed 34 queued video frames
  (1.13 seconds), proving that retaining the complete startup backlog traded the
  earlier relative A/V offset for visible video latency.
- Replaced the eight-second FIFO with a frame-aware three-frame latest-content
  window. When ffmpeg falls behind, it evicts the oldest queued picture and
  retains the newest frames; continuous audio therefore remains the timeline
  anchor while video content catches up instead of preserving stale pictures or
  discarding the newest content.
- Generalized the shared stream lifecycle's frame-sink contract from
  `PassThrough` to a readable sink with `write`, `end`, and `writableLength`, so
  MK64 can provide frame-aware buffering without changing Pokemon's existing
  `PassThrough` implementation.
- Added tests proving a stalled sink receiving `[1, 2, 3, 4]` emits
  `[2, 3, 4]`, remains bounded, counts eviction/delivery separately, rejects
  malformed raw frames, and fails writes after end. MK64, shared lifecycle, and
  shared core tests/typechecks/lints pass; Pokemon typecheck and Knip also pass.

### Remaining

- Publish and deploy the latest-content candidate, then obtain manual
  confirmation that both audio synchronization and video latency are correct.
- Remove the temporary Argo CD acceptance hold, restore normal automated
  reconciliation, and confirm replacement current-head Buildkite CI.
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
- The earlier live claim that audio and video were in lockstep was too strong:
  packet pacing and media duration did not measure relative content offset.
  Manual listening was the independent oracle that exposed the missing
  content-timeline coupling.
- Directly withholding PCM for a raw second ffmpeg input is not viable during
  startup: ffmpeg needs both inputs to advance. The rejected live candidate
  demonstrated the resulting positive-feedback stall before the design was
  replaced with whole-emulator backpressure.
- Whole-emulator backpressure is the bounded-queue safety net, not a substitute
  for correct input initialization. Its first live candidate exposed that the
  nominal low-latency flags were attached after the input scope and therefore
  could not prevent the startup probe wall.
- `analyzeduration=0` did not eliminate the byte-probe dependency by itself.
  The probe-size override must remain scoped to explicitly typed raw inputs;
  applying the minimum globally could break codec/container discovery for
  other stream sources.
- The steady-state video queue remains a three-frame budget. During the N64
  audio-ring warm-up, video may temporarily exceed that high-water mark until
  one second of PCM has been forwarded; the reproduced video-first case peaked
  at about 22.7 MB.
- Audio pre-roll alone was insufficient because ffmpeg needed the resumed
  emulator to continue feeding PCM before its startup video queue could fully
  drain. First encoder progress is therefore a one-time initialization signal;
  only `drain` may release later backpressure pauses.
- The first implementation consumed that one-time signal even when no sink
  backlog was active. Live ordering demonstrated that progress can precede the
  PCM-gated pause, so the corrected transition keys the bypass to an
  outstanding full-sink interval rather than to the first callback globally.
- The subsequent live run proved that even correctly ordered pause/resume is
  unsafe for this dual raw-input command: pausing the shared producer can
  deprive ffmpeg of the PCM required to drain its video input. The final design
  does not pause a running emulator for encoder backpressure.
- The bounded burst buffer is deliberately larger than the old low-latency
  queue. Encoder-first startup and minimum raw-input probing should keep its
  normal occupancy small; the 240-frame limit is a fail-fast safety margin, not
  permission for sustained sub-realtime encoding.
- The live 34-frame measurement rejected that burst-buffer assumption. The
  latest-content queue restores the original three-frame latency budget but
  evicts oldest queued content, correcting the old policy's direction.
- The live candidate is intentionally pinned while awaiting manual listening.
  The `mario-kart` Application has `skip-reconcile=true` and automated sync
  disabled; both must be removed after acceptance so GitOps resumes ownership.
- `/stop` completed and the stream shut down, but its asynchronous session-end
  callback ran after `WorkerEmulator.stop()` and logged
  `emulator worker is not running`. That distinct lifecycle defect is now
  tracked separately.

## Workflow Friction

- The `monorepo-docs` skill says to run `bun run check-docs`, but the root
  `package.json` has no `check-docs` script. The supported root command is
  `bun run check-todos`, which invokes
  `packages/docs-board/src/cli/check-docs.ts` and validates the full docs model.

## Session Log — 2026-07-28 (Stream latency measurement)

### Done

- Approved the server-owned measurement boundaries and calibration approach.
- Added encoded-packet PTS/duration and RTP-send PTS checkpoints to the shared
  stream observer.
- Correlated raw video, raw PCM, controller receipt, encoded packets, and sends
  through the Worker and latest-frame queue. Input carried by an evicted frame
  is attributed to the next visible frame.
- Added passive Prometheus metrics and browser performance-summary fields for
  packet-ready delay, send-complete delay, input latency, signed A/V
  source-content offset, and correlation failures.
- Added the `e2e:stream-latency` flash/chirp calibration harness and JSON
  report. The software pipeline measured `-1.0 ms` A/V p50 at baseline,
  recovered an injected `+100 ms` audio delay as `+99.3 ms`, and recovered
  three delayed video frames as `-101.0 ms`.
- Passed MK64 backend typecheck, lint, and 137 tests; MK64 root checks;
  discord-video-stream build, typecheck, and 60 tests; and streambot typecheck,
  lint, and 384 package tests.

### Remaining

- [ ] Publish the updated PR and restore the temporary acceptance deployment.
- [ ] Exercise the passive metrics on the live VAAPI stream and record the
      resulting baseline.
- [ ] Restore normal Argo CD reconciliation after live acceptance.

### Caveats

- The ROM-backed and live VAAPI checks are not CI-portable.
- The synthetic calibration validates the same H.264/Opus/NUT media boundary
  but uses the software encoder locally; VAAPI is covered by the live run.
