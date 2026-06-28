# MK64 end-to-end latency instrumentation

## Status

Complete — shipped in PR #1128.

## Context

Players hit "massive input lag" on the 2026-06-07 session. Existing metrics showed the backend healthy (flat 30fps, zero sink buffer, no throttling), pointing by elimination at Discord Go-Live's viewer path. PR #1128 (branch `feature/mk64-latency-overlay`, worktree `.claude/worktrees/mk64-latency-overlay`) added a capture-time UTC clock overlay for glass-to-glass measurement. This plan adds enough instrumentation that a post-session Grafana/Loki analysis can attribute lag to _each_ segment — controller→backend, receipt→applied-in-tick, frame→encoder, encode health, encoder→RTP send — so whatever remains is provably Discord-side. All work stacks onto PR #1128 (same theme, one PR). **Mario Kart only** (pokemon panels stay empty); **input-echo HUD included** (user confirmed both).

Key reuse: the vendored fork already plumbs a `StreamObserver` callback interface through `prepareStream`/`playStream` (`packages/discord-video-stream/src/media/newApi.ts:141, :614`), and `packages/streambot/src/observability/stream-observer.ts:59-117` is a proven implementation mapping it to Prometheus. GameStreamer simply never passes an observer. Streambot's module can't be imported (separate nested workspace, own logger/registry) — copy/adapt the ~60-line pattern.

## Segment coverage once done

| Segment                        | Signal                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| Controller → backend           | `controller_rtt_ms` (client-measured RTT, reported to server — no clock skew)            |
| Receipt → applied in tick      | `emulator_input_apply_delay_ms`                                                          |
| Applied → frame rendered       | ≤1 frame by construction (33ms)                                                          |
| Frame → encoder                | `stream_frame_interval_ms`, `stream_frame_write_ms`, existing `stream_sink_buffer_bytes` |
| Encode health                  | `stream_ffmpeg_speed_ratio` / `_fps` / `_bitrate_kbps`, `stream_hw_encode_engaged`       |
| Encoder → RTP send             | `stream_send_frametime_ratio`, `stream_send_late_frames_total`                           |
| Glass-to-glass                 | UTC clock overlay (PR #1128) vs real clock                                               |
| Press → glass                  | input-echo HUD digit vs keypress in a screen recording                                   |
| Discord ingest + viewer buffer | glass-to-glass minus all of the above (by subtraction)                                   |

## Changes (all paths relative to the worktree root)

Base dir: `packages/discord-plays-mario-kart/packages/` unless noted.

### 1. Controller RTT reporting

- `common/src/model/input.ts` + `common/src/model/index.ts`: new `LatencyReportRequestSchema` — `z.strictObject({ kind: z.literal("latency-report"), rttMs: z.number().min(0).max(60_000) })`, added to the `RequestSchema` discriminated union. **`InputRequestSchema` untouched** (no strict-parse rollout hazard; frontend is served by the backend so skew is just stale tabs).
- `backend/src/webserver/dispatch.ts`: new ts-pattern arm observing `controller_rtt_ms`.
- `backend/src/webserver/socket.ts:49-52`: demote the two per-request `logger.info` (with full payload) to `debug` for `input`/`latency-report` kinds — prevents Loki spam (already per-keypress today).
- `frontend/src/app.tsx:21-26`: in the existing 2s ping interval, after `setLatency(rtt)`, also emit `{ kind: "latency-report", rttMs: rtt }`.

### 2. Input receive→apply latency

- New `backend/src/input/input-latency-tracker.ts`: small class with injectable `now` — `record(seat)` (earliest pending timestamp wins), `clear(seat)`, `drainAll(observe)`. One observation per new-state-first-applied; cleared on drain/disconnect.
- `backend/src/emulator/n64-emulator.ts`: instantiate tracker; `setPlayerInput` (line ~231) → `record`; `clearPlayerInput` → `clear`; in `tick()` right after the `rt.send` latch loop (line ~287) → `drainAll` into the histogram. The socket→dispatch→setPlayerInput chain is synchronous, so stamping inside `setPlayerInput` needs no signature changes.
- New method `seatActivity(): boolean[]` (any button held or |analog| > 0.25) for the HUD.

### 3. Stream observer + frame jitter + session summary

- New `backend/src/stream/stream-observer.ts` (adapt from `packages/streambot/src/observability/stream-observer.ts:59-117`): `parseTimemarkSeconds`, speed ratio from timemark-delta vs injected `now()` (keep the `deltaMedia > 0` guard), hw-**encode** detection via `/h264_vaapi|hwupload/` (rawvideo input — encoder check, not `-hwaccel`); `onCommand` → gauge + one `logger.info` of the ffmpeg command line; `onProgress` → fps/kbps/speed gauges + rate-limited warn (speed <0.95 for ~5s, ≤1/min); `onSendStats` → ratio histogram + late counter + session stats.
- `backend/src/stream/game-streamer.ts`: time `bgra.write` (`stream_frame_write_ms`); inter-`pushFrame` gap (`stream_frame_interval_ms`, reset across start/stop); create session stats + observer in `doStartInner`, pass `observer` to **both** `prepareStream` opts and `playStream` opts; on stop: zero ffmpeg gauges, `logger.info("stream session summary", { durationS, framesPushed, pushedFps, videoFramesSent, lateVideoFrames, latePct, lastSpeedRatio })`.

### 4. Metrics (`backend/src/observability/metrics.ts`)

New instruments on the existing registry (existing naming style; total ≤2 label values — `kind` on the send pair only):
`emulator_input_apply_delay_ms` (hist, `[1,2,4,8,16,25,33,50,100,250]`), `controller_rtt_ms` (hist, `[5,10,25,50,75,100,150,250,500,1000,2500]`), `stream_frame_interval_ms` (hist, `[16,25,30,33,36,40,50,66,100,200]`), `stream_frame_write_ms` (hist, frame-ms buckets), `stream_ffmpeg_speed_ratio` / `stream_ffmpeg_fps` / `stream_ffmpeg_bitrate_kbps` / `stream_hw_encode_engaged` (gauges), `stream_send_frametime_ratio` (hist, `[0.25,0.5,0.75,0.9,1,1.1,1.25,1.5,2,3]`, label `kind`), `stream_send_late_frames_total` (counter, label `kind`).

### 5. Input-echo HUD (`backend/src/stream/overlay.ts`, `backend/src/index.ts`)

- `formatSeatFlags(held)` → `"1..4"` style (digit when held, `.` idle — glyphs already in the font); `drawHudOverlay(frame, width, epochMs, held)` = timestamp + flags (~21 chars ≈ 512px, fits 640; clipping is non-throwing). Keep `drawTimestampOverlay` exported.
- `index.ts` onFrame: `drawHudOverlay(frame, WIDTH, Date.now(), capturedEmulator.seatActivity())`.

### 6. Grafana dashboard (`packages/homelab/src/cdk8s/grafana/discord-plays-dashboard.ts`)

Existing builder pattern + `SCOPE`; append rows at y=39+:

- **Input path latency**: input apply delay p95; controller RTT p50/p95.
- **Encoder / send health**: ffmpeg speed ratio (desc "<1 sustained ⇒ encode can't keep realtime"); ffmpeg fps+kbps; send frametime ratio p95; late send frames rate; frame push interval/write p95.
- Add `createDiscordPlaysDashboard()` to `dashboard-query-health.test.ts:11-22` corpus (currently absent — cheap hardening).

## Explicitly not doing

- Per-input/per-frame Tempo spans — `tracing.ts` warns off; metrics + two per-session log lines + one rate-limited warn cover analysis needs without flooding.
- Pokemon parity, WebRTC controller-page feed (step 2 if measurements confirm Discord), any shared observer package.

## Tests

- New `input-latency-tracker.test.ts`: record→drain once; double-record keeps earliest; re-record after drain; clear drops; OOB seat no-op (injected `now`).
- New `stream-observer.test.ts`: timemark parsing (incl. garbage); speed ratio from two progress samples; stalled timemark writes nothing; sendStats ratio>1 increments counter+stats; hw-encode detect vaapi vs libx264 cmdline; warn rate-limit. Assert registry **deltas**.
- Extend `dispatch.test.ts` (real Socket.IO loopback): valid latency-report observes `controller_rtt_ms`; invalid `rttMs` rejected without crash.
- Extend `overlay.test.ts`: `formatSeatFlags`; held seat renders white pixels in flags region; existing tests untouched.
- New test files need entries in `backend/eslint.config.ts` `allowDefaultProject`.

## Commit sequence (stacked on PR #1128)

1. RTT reporting (common + dispatch + socket demotion + frontend + metric + test)
2. Input apply-delay tracker (+ emulator wiring + test)
3. Stream observer + frame jitter + session summary (+ test)
4. Input-echo HUD (+ `seatActivity` + test)
5. Dashboard rows (+ query-health corpus)

## Verification

- `bun run typecheck && bun test && bunx eslint .` in `packages/discord-plays-mario-kart` (workspace root covers common/frontend/backend) and `packages/homelab` (dashboard tests incl. helm-escape + query-health).
- Render an updated HUD sample PNG (existing overlay+encodePng path) and `toolkit pr asset` it onto PR #1128 (use `SEAWEEDFS_*` env workaround).
- Post-deploy runbook (goes in the session log): start a stream, hold a button; check `/metrics` for the new series; Grafana rows populate; on stop, session summary line in Loki; press→glass from a recording of the Discord stream.

## Risks

- Old open frontend tab vs new backend: fully compatible (InputRequest unchanged). New tab vs old backend: a parse-reject log every 2s until refresh — harmless, rare.
- `pushFrame` hot path: +2 `performance.now()`/observe per frame — same cost class as existing emulate/copy instrumentation.
- Registry assertions must be delta-based (shared registry across tests in a file).
