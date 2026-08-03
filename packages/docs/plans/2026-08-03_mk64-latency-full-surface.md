---
id: plan-2026-08-03-mk64-latency-full-surface
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# MK64 in-Discord latency: full-surface implementation plan

Mirror of the approved 2026-08-03 harness plan. Evidence base and per-lever
research live in
[`2026-08-03_mk64-in-discord-latency-burn-down.md`](2026-08-03_mk64-in-discord-latency-burn-down.md);
measurement provenance in
[`../logs/2026-08-02_mk64-input-lag-attribution.md`](../logs/2026-08-02_mk64-input-lag-attribution.md).

Constraints (user): Discord-only video path, single-player first, no
run-ahead, no UI-echo. Goal: ~halve LAN felt lag (~210–360 ms → ~160–280 ms);
75% is unreachable in-Discord (Discord-leg floor ≈60–100 ms + MK64's own
66–133 ms reaction).

## Phase 1 — PR 1: Tier 1 + the ruler (this branch)

Fork (`packages/discord-video-stream`), all opt-in so streambot/pokemon
defaults are untouched, with assert-default tests:

- 1a `Encoders.vaapi` gains `asyncDepth` → `-async_depth 1` for MK64
  (~33 ms; VAAPI default 2 holds one frame in the encode FIFO).
- 1b `prepareStream` low-latency opt-in → `-flush_packets 1` on the NUT
  output (0–5 ms tail guard).
- 1c Same opt-in → Opus `-application lowdelay -frame_duration 10`
  (~10–16 ms audio; shrinks the viewer's A/V-sync pull-up).

MK64 (`packages/discord-plays-mario-kart`):

- 1d Frontend: immediate emit on button edges; 16 ms coalesce kept for
  analog only (`frontend/src/app.tsx`). ~8 ms mean.
- 1e Backend config knob enabling the fork opt-ins + async_depth A/B toggle
  (`backend/src/config/schema.ts` → `game-streamer.ts`).

Instrumentation (same PR):

- 1f `videoSources`-depth gauge + delivered/emitted counters
  (`stream-latency-tracker.ts`, `observability/metrics.ts`,
  `game-streamer.ts`) — decisive discriminator for
  [`mk64-stream-latency-correlation-desync`](../todos/mk64-stream-latency-correlation-desync.md).
- 1g Manual event-loop-lag histograms, main + worker (20 ms sampler; Bun's
  `monitorEventLoopDelay` verified broken).
- 1h Fine-bucket `stream_send_interval_ms` at `onSendStats`.
- 1i `backend/scripts/e2e-viewer-stats.ts`: RTCPeerConnection hook +
  ~250 ms `getStats` poller for the PinchTab Discord viewer tab →
  jitterBufferDelay / freezeCount / packetsLost / framesDecoded JSON.

Rejected on evidence (do not implement): `-max_interleave_delta 0`, 60 fps
output, sink 3→2, pacing-sleep removal, 60 Hz latch (already exists),
mid-VI injection, run-ahead, UI echo.

Verification: fork + backend + frontend turbo typecheck/test/lint;
`e2e:stream-latency` still green; live A/B async_depth 1-vs-2 by digest
deploy with Argo hold (glass decode + 1i ruler + depth gauge), numbers
recorded here.

## Measurement method (established 2026-08-03; use this, not screenshots)

Glass-to-glass is measured **in-page**: draw the Discord viewer's `<video>`
element to a canvas, return only the overlay-badge crop as PNG, decode the
burned-in clock with the overlay's own 5×7 glyph table, and compare against
the page's own `Date.now()` at draw time (same host as the analysis script,
so only the pod's clock lead applies). This yields ~20 samples/s with
Hamming-distance-0 decodes and **no capture-window uncertainty** — a large
improvement over the 2026-08-02 CDP-screenshot rig (~2.8 samples/s with a
one-sided ~330 ms window that made the mean unusable). Probe:
`scratchpad/glass_probe.py` pattern; calibration must try every bright-row
band (bright game content above the badge otherwise wins a naive
first-bright-row heuristic).

**Per-SESSION client state is the dominant term, and it is not stream age.**
Measured glass-to-glass on the SAME build varies by hundreds of ms between
sessions:

| Arm       | stream age | glass-to-glass mean               |
| --------- | ---------- | --------------------------------- |
| candidate | ~10 min    | **68.5 ms** (p50 67.4, n=1204)    |
| candidate | ~1-2 min   | 325.8 ms (p50 326.1, n=1200)      |
| candidate | 0-12 min   | 317.1 ms (p50 316.1, n=716 curve) |
| baseline  | ~1-2 min   | 369.8 ms (p50 373.7, n=1207)      |
| baseline  | ~4 min     | 358.3 ms (p50 359.7, n=908)       |

A 12-minute continuous curve on the candidate is **flat** (per-2-min means
332 / 304 / 337 / 308 / 299 / 322 ms) — so the low 68.5 ms reading is NOT
stream-age decay, which was the first hypothesis and is refuted. It is a
distinct, persistent low-latency playout state that the client entered once
(that session had 4 freezes / 463 lost packets / 157 NACKs shortly before,
consistent with a jitter-buffer re-anchor after a discontinuity) and held
for at least a minute. It was not reproducible on demand.

Consequences for any latency A/B through Discord:

- The between-session client-state range (~68-370 ms) is **5-7x the
  effect size** of the entire Tier-1 bundle (~40-60 ms), so one session per
  arm cannot resolve it. A credible glass-level A/B needs many alternating
  short sessions per arm, or a way to force the client into a known playout
  state.
- Viewer-side `jitterBufferDelay` (84 ms in both arms) does NOT track the
  glass number and cannot substitute for it: it reports only the receiver's
  de-jitter buffer, not total playout latency.
- Server-side deltas remain the practical acceptance signal for encode-side
  changes (see the Phase 1 results below).

## Phase 1 live results (2026-08-03)

Candidate image `candidate-9a45c738@sha256:0ad60c00` deployed by digest with
an Argo hold; baseline is production main `2.0.0-7794`.

**Flags verified in the live ffmpeg command** (pod log): `async_depth 1`,
`flush_packets 1`, `lowdelay`, `frame_duration 10`, `h264_vaapi`.

**Server-side, matched 12-press windows:**

| Metric                                     | baseline  | candidate | delta     |
| ------------------------------------------ | --------- | --------- | --------- |
| `stream_packet_ready_delay_ms{video}` mean | 1222.8 ms | 1164.5 ms | **-58.3** |
| `stream_input_to_send_complete_ms` mean    | 1248.4 ms | 1181.3 ms | **-67.1** |
| `emulator_input_apply_delay_ms` mean       | 9.5 ms    | 9.3 ms    | -0.2      |
| ffmpeg fps                                 | 29.92     | 29.95     | held      |
| frames dropped (window)                    | 5         | 2         | improved  |

Both arms carry the same standing pairing offset (the known corruption in
[`mk64-stream-latency-correlation-desync`](../todos/mk64-stream-latency-correlation-desync.md)),
so the absolute values are meaningless but the **delta is meaningful**, and
-58 ms matches the predicted ~45-60 ms encode-side saving. Encoder health
held: 30 fps, VAAPI engaged, fewer drops.

**Glass-side: not separable in one session per arm** — see the client-state
finding above. This is a measurement-power limit, not evidence against the
change.

**Verdict:** ship Tier 1 on the server-side evidence plus the mechanism
(ffmpeg holds `async_depth` frames in the encode FIFO by construction) and
the unchanged encoder health. Do NOT claim a measured glass-level win.
The client playout buffer is now demonstrably the largest single term in
the budget, which promotes the Phase 2 playout-delay experiment to the
highest-value next lever.

## Phase 2 — Tier 2 A/B gambles (adopt on evidence, one at a time)

playout-delay max 100→30 ms; wire pacer 25→50 Mbps; camera-mode vs Go-Live
(adopt at ≥150–200 ms only, product tradeoffs need user sign-off);
video-only session to price the audio-sync pull-up.

## Phase 3 — Metric repair (stacked PR, uses 1f evidence)

Pin the startup 1:1 break (pre-attach packet discard audit; in-cluster
VAAPI parity count), fix it (stop the drop / skip-N compensation /
timestamp pairing with explicit startup offset), re-derive the A/V gauge,
add a startup/attach-gap calibration scenario, re-run attribution until
`stream_input_to_send_complete_ms` matches the glass ~100–150 ms; then
archive the desync todo.

## Phase 4 — Downstream freeze attribution (measurement only)

1i poller vs burned-in clock during a normal session; discriminate client
jitter-buffer vs network vs viewer-machine; route outcomes accordingly.

## Phase 5 — 4P readiness gate (after 1P ships)

4-seat busy-track stress; `emulator_frame_emulate_ms` / `late_ms` /
resyncs / fps. Hypothesis: software angrylion goes sub-realtime at 4P →
follow-up plan (threads → parallel-RDP → native emulator).

## Remaining

- [x] Phase 1 implementation + local verification + draft PR.
- [ ] Phase 1 live A/B acceptance run (async_depth), numbers recorded here.
- [ ] Phase 2 experiment session; adopt/reject recorded here.
- [ ] Phase 3 metric repair + todo archival.
- [ ] Phase 4 freeze-attribution session.
- [ ] Phase 5 4P stress measurement → follow-up plan.

## Comment Log

- 2026-08-03: Plan approved in harness plan mode; mirrored here per
  convention. Worktree `feature/mk64-latency-tier1` (native GitHub stack).
- 2026-08-03: Phase 1 implemented. Fork: `Encoders.vaapi({asyncDepth})`,
  `prepareStream` `lowLatencyMux`/`lowDelayAudio` opt-ins (defaults
  unchanged, assert-default tests added; 70 fork tests green). MK64: config
  knobs (`encoder_async_depth`/`low_latency_mux`/`low_delay_audio`, defaults
  on), frontend coalesce removed — discovery: ALL controls are discrete
  edges (analog derives from held codes in computeState), so the 16 ms timer
  bought nothing and immediate edge-emit replaces it wholesale.
  Instrumentation: `stream_tracker_video_source_depth` gauge,
  `stream_send_interval_ms` fine buckets, `event_loop_lag_ms{thread}` manual
  samplers on main + emulator worker (via the metric bridge; batch schema
  extended), `scripts/e2e-viewer-stats.ts` receive-side getStats ruler
  (RTCPeerConnection constructor hook — install BEFORE joining voice, or
  `--reload`). Synthetic calibration unchanged at −1.0 ms A/V p50. Delivered
  frames ≈ `stream_frame_interval_ms_count − stream_frames_dropped_total`;
  emitted packets = `stream_packet_ready_delay_ms_count` (no redundant
  counters added).
