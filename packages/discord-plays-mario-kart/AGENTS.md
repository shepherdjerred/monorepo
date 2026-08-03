# discord-plays-mario-kart — agent notes

Headless MK64 (N64Wasm: parallel-n64 + angrylion) streamed to Discord; up to 4
people drive seats P1–P4 from a React web UI over Socket.IO. See `README.md` for
the architecture; this file is the quick orientation for agents.

The tracing/metrics wiring, loopback audio transport, Go-Live streamer base class,
web server, and bot entrypoint are shared with discord-plays-pokemon in
**`@shepherdjerred/discord-plays-core`** (`packages/discord-plays-core`,
source-only, subpath imports) — see its `AGENTS.md`. This backend supplies the
MK64-specific pieces: the N64 emulator, `MarioKartGameDriver`, seats /
leaderboard / name overlay, the richer ffmpeg/send-path metrics + `copyMs`, the
socket dispatch, and the `GameStreamerBase` hook overrides (frame-drop policy,
StreamObserver, session summary, guarded client destroy).

## The ROM (not in the repo)

The MK64 ROM is **copyrighted** and the repo is **public** with a 5 MB
per-file pre-commit limit, so it is never committed (not even encrypted). The
canonical copy lives in Syncthing at **`~/syncthing/Sync/roms/mariokart64.z64`**
(replicated across the owner's machines). Everything that needs it resolves the
path the same way (`resolveRom()` in `packages/backend/scripts/lib/harness.ts`):

1. explicit `--rom <path>` / first positional arg
2. `MK64_ROM` env var
3. the Syncthing default above

Production gets the ROM via a one-time `kubectl cp` onto the ROM PVC (README →
One-time provisioning); the deployed pod does not fetch it.

## Test harness (`packages/backend/scripts/`)

Manual, ROM-gated (never CI). The unit tests (`*.test.ts`, run in CI) remain the
automated gate; these harnesses are for driving the real game.

- **`e2e-scenario.ts`** (`bun run e2e:scenario`) — drive the game to a named
  scenario and optionally screenshot it. `bun run e2e:scenario` with no args
  lists scenarios (`menu`, `1p`–`4p`). Flags: `--rom`, `--shot out.png`,
  `--names a,b,c,d`, `--watch` (log state transitions). This regenerates the
  1p–4p leaderboard overlay screenshots.
- **`e2e-race.ts`** (`bun run e2e:race`) — stream raw RDRAM globals while the
  attract demo / `start-mash` runs; the tool for validating the `mk64-memory.ts`
  address map.
- **`e2e-input.ts`** / **`e2e-input-assert.ts`** — prove a web keypress reaches
  the game (frame-hash diff).
- **`e2e-stream-latency.ts`** (`bun run e2e:stream-latency`) — encode
  synchronized video flashes and audio chirps through the production
  H.264/Opus/NUT pipeline, decode them, and report media delay and signed A/V
  offset without including Discord. Positive A/V offset means audio lags.
  `--audio-delay-ms` and `--video-delay-frames` inject known delays for analyzer
  validation.
- **`e2e-viewer-stats.ts`** (`bun run e2e:viewer-stats`) — receive-side WebRTC
  ruler for the Discord viewer leg. Polls `RTCInboundRtpStreamStats`
  (jitterBufferDelay, freezeCount, packetsLost, decode FPS) plus selected-pair
  RTT from a PinchTab-driven Discord web-client tab watching the Go-Live stream,
  giving viewer-side numbers no server-side metric can see. Discord hides its
  `RTCPeerConnection`, so the script installs a constructor hook that only
  captures peers created _after_ it runs: start it before the viewer joins, or
  pass `--reload` to reload the tab (it reinstalls the hook, then you re-join
  voice and re-open the stream before sampling). Prerequisites: a running
  PinchTab instance with a Discord tab, `--tab <tabId>`, and a `PINCHTAB_TOKEN`
  (env or the standard PinchTab config file). Flags: `--duration`,
  `--interval-ms`, `--out`, `--pinchtab`, `--reload`.
- **`lib/harness.ts`** — reusable primitives: `resolveRom`, `bootEmulator`
  (sprint mode, deterministic per-tick), `driveUntil({schedule, until,
timeoutFrames, onTick})`, `captureScreenshot({path, names, screenMode})`.
- **`lib/scenarios.ts`** — scenarios as data (input schedules + reach
  predicates). **Add a scenario by adding an entry here.**

**Menu-nav gotcha:** multiplayer character select blocks until _every_ seat
presses A — the schedules mirror A onto all N controllers. Drive into a race by:
tap START to the GAME SELECT menu → press RIGHT (seats−1) times to pick the
N-player column → mirror A on all seats through char/course select into racing.

## Controller input

The headless N64Wasm host latches web inputs into `g_neilHostPads[4]` and
re-applies them every frame via `applyHostControls()` (in
`wasm-src/patches/0001-*.patch`). This works around `mainLoopInner()` calling
`resetNeilButtons()` every frame — the original code wrote `neilbuttons[*]` once
before `_runMainLoop()`, so all input was silently dropped (frames still
rendered). Because the WASM is built at image-build time (gitignored assets;
CI builds, smokes, and pushes the image on merge to main via the `smoke`/image
lanes in `.buildkite/pipeline.yml`), a fix here needs an image rebuild + GitOps
redeploy to reach prod. Manual
game-effect verification (needs ROM + built core): from `packages/backend`,
`bun run build:wasm` then `bun run e2e:input:check "<rom>"` — holding START on
the title screen must advance to GAME SELECT while the baseline stays put.

## Stream performance & profiling

Input lag is **not** the encoder. The VAAPI `h264_vaapi` path benchmarks at
~16.7× realtime — keep hardware encode. The real bottleneck: the emulator
`runMainLoop` (p95 `emulate_ms` ≈ 30ms of the 33ms budget) and Discord stream
I/O share one Node event loop, starving ffmpeg below realtime in prod →
`pushFrame` piled frames into an unbounded `PassThrough` (`stream_sink_buffer_bytes`
hit 3.47 GB ≈ 188s of lag, OOM risk vs the 4 GB limit). Fix (PR #1274):
`shouldDropFrame` drops the newest frame once the queue exceeds
`MAX_SINK_BUFFER_BYTES` (~3 frames) — bounds latency, degrades fps. Restoring
full 30fps under load needs the emulator on a Worker thread
(`packages/docs/todos/mk64-emulator-worker-thread.md`).

Diagnosis: `stream_sink_buffer_bytes` growing unbounded is the smoking gun;
`stream_ffmpeg_speed_ratio` < 1 sustained; the `e2e:perf` harness drives only
the emulator path (empty `onFrame`) so it can't exercise the sink.

For server-owned latency attribution, use the stream observer metrics rather
than visual estimates from Discord. `stream_packet_ready_delay_ms` and
`stream_send_complete_delay_ms` cover raw-media availability to encoded packet
readiness and RTP completion. `stream_input_to_packet_ready_ms` and
`stream_input_to_send_complete_ms` correlate a controller receipt with the
first video packet containing that state. `stream_av_content_offset_ms` is
signed source-content skew (positive means audio lags); correlation misses must
increment `stream_latency_correlation_failures_total` instead of silently
guessing.

Profiling: node-wide `pyroscope.ebpf` → Pyroscope has `mario-kart/main`, but
~64% of Bun samples are `[unknown]` (eBPF can't symbolize Bun's JIT'd JS/wasm).
For symbolized JS, PR #1274 added on-demand capture:
`kubectl exec -n mario-kart deploy/mario-kart -- sh -c 'kill -USR2 1'` runs the
JSC sampling profiler for ~30s and writes folded stacks (speedscope) to the logs.

**N64 timing contract:** `_runMainLoop` advances one 60 Hz vertical interrupt;
MK64 renders one video frame every two interrupts. Pace core steps at 60 Hz,
drain audio after every step, and emit video after every second step at 30 fps.
Do not batch both core steps into one video deadline: the resulting 24–60 ms
burst misses the 33 ms output budget. One core call per 30 fps output frame
slows game time and 44.1 kHz PCM to 0.5×; ffmpeg then blocks on audio, queues
video, and the frame gate drops roughly half the frames. The ROM-gated
`e2e:audio --rom` duration assertion is the end-to-end guard.

## Conventions

- Bun only; strict TS; no `as` casts; no `.then/.catch` (use async/await); Bun
  APIs over `node:fs`; `max-params` ≤ 4 (bundle into an opts object).
- Scenario screenshots: white-on-black labels are channel-symmetric, so the
  stream-overlay primitives (`src/overlay/`) render correctly on the RGBA
  screenshot path too — `captureScreenshot` reuses them directly.
