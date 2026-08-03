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

**Glass-side, matched 12-minute curves (the decisive comparison):**

| Arm       | n   | mean     | p05      | p50      | p95      | sd      |
| --------- | --- | -------- | -------- | -------- | -------- | ------- |
| baseline  | 715 | 371.6 ms | 282.6 ms | 363.6 ms | 465.8 ms | 88.9 ms |
| candidate | 716 | 317.1 ms | 233.1 ms | 316.1 ms | 389.9 ms | 64.7 ms |

**Difference: −54 ms, 95% CI [−72, −36]** (moving-block bootstrap, 30 s
blocks, 20 000 resamples). The candidate is significantly lower, and its
spread is tighter (sd 64.7 vs 88.9), consistent with less encoder jitter
from `async_depth 1`.

Note the CI must be a **block** bootstrap: consecutive glass samples are
autocorrelated (integrated autocorrelation time 9.6 s baseline / 4.8 s
candidate at ~1 sample/s), so effective n is ~75 and ~150, not 716. An
i.i.d. bootstrap over samples reports [−62.9, −46.7] — about 2.2x too
narrow. Interval width by block length: 16 ms (i.i.d., wrong), 28 ms
(10 s), 36 ms (30 s), 42 ms (60 s); the effect stays significant at every
block length. **Any future glass A/B must use the block bootstrap** and
report the autocorrelation time it assumed.

**Encoder isolation (in-pod, real iGPU, no Discord in the path).** Fed
rawvideo at a true 30 fps cadence through the production filter chain into
`h264_vaapi` and timed each frame from stdin-write to its Annex-B access
unit appearing on stdout (`-bf 0` ⇒ one AU per frame). Alternated arms,
two runs each, 300 frames per run, first 30 frames discarded:

| `-async_depth`     | frame-in → packet-out (mean) |
| ------------------ | ---------------------------- |
| 2 (ffmpeg default) | 68.15 ms / 68.04 ms          |
| 1 (this PR)        | 36.88 ms / 36.82 ms          |

**−31.2 ms, reproducible to within 0.1 ms**, ≈ exactly one frame interval —
precisely the mechanism (the encode FIFO holds `async_depth` frames).
Incidentally the runs emitted 299 packets for 300 frames, independently
reproducing the fixed +1-frame startup boundary noted during the desync
review.

**Triangulation — three independent paths agree:**

| Measurement              | scope              | delta                        |
| ------------------------ | ------------------ | ---------------------------- |
| In-pod encoder isolation | `async_depth` only | −31.2 ms                     |
| Server-side histograms   | whole bundle       | −58.3 ms                     |
| Viewer glass-to-glass    | whole bundle       | −54.5 ms (CI [−62.8, −46.6]) |

The two whole-bundle numbers agree within ~4 ms, and the ~23 ms they exceed
the isolated encoder saving is consistent with the Opus low-delay change
(10 ms frames vs 20 ms, confirmed live: audio send interval measured
exactly 10.0 ms) plus the muxer flush. Independent methods converging on
the same effect is far stronger than any one of them alone.

Honest limit: this is one session per arm, so even the block-bootstrap CI
captures only within-session variation, not between-session client-state
variance (which the 68.5 ms outlier shows can be far larger). The agreement
with the server-side metric and the mechanism is what makes the result
credible; a hostile reviewer should ask for alternating repeat sessions
before treating −54 ms as the exact effect size.

## Methodology debt (fix before the Phase 2 experiments)

Tonight's run exposed concrete gaps. Phase 2's levers (playout-delay hint,
camera mode) are expected to be smaller and noisier than Tier 1, so these
are prerequisites, not polish:

1. **Run an A/A control first.** Baseline vs baseline, same protocol. It was
   never done and it is the cheapest validation available: if A/A returns a
   "significant" difference, the whole comparison method is broken and every
   A/B number is suspect. It also directly measures between-session client
   variance, which is currently the largest unquantified error term.
2. **Alternate short sessions; make SESSION the unit of analysis.** Six 4-min
   sessions per arm in ABABAB order beats one 12-min session per arm: it
   converts session state from an uncontrolled confound into measured
   variance, and spreads time-of-day/network drift across both arms.
3. **Make probes refuse impossible data.** Both rig bugs this session were
   caught by eye, not by the tooling. Every probe should assert its
   invariants and fail loudly: glass-to-glass >= 0 (the 2026-08-02 rig
   emitted 45% negatives and still produced a "mean"), sample span within
   10% of the requested duration (the stale-`__vsLast` bug produced a 452 s
   span for a 60 s run), monotonic RTP counters, and decode distance 0.
4. **Write the analysis plan before collecting.** Window, statistic,
   exclusions, and stopping rule were all chosen after seeing data this
   session (the matched-age window was invented once the age confound
   appeared) — textbook forking paths, even when the conclusion holds.
5. **Normalize the corrupted server metric instead of only differencing it.**
   With the depth gauge live, true delay ≈ reported − depth x frame-interval.
   That yields a usable absolute number today and removes the assumption
   that the standing offset is identical across arms (depth already varies
   34-36 within one session).
6. **Isolate the remaining flags.** `low_latency_mux` and `low_delay_audio`
   are still bundled; the config knobs to separate them already shipped in
   PR #1965 and were never exercised.
7. **Control the obvious confounds.** Fixed game scene (encode complexity
   varies by track), quiet viewer machine (the capture host was also
   building images tonight), and interleaved arms.
8. **Promote the probes to committed, tested code.** `glass_probe.py` and the
   comparison script live in scratchpad; the calibration pitfall (bright game
   content above the badge) will be rediscovered the hard way otherwise.

**Verdict: ship.** Tier 1 delivers a measured **~55 ms** reduction at the
player's eye (95% CI [−63, −47]), corroborated by an independent −58 ms
server-side delta and by the mechanism itself, with encoder health held
(30 fps, VAAPI engaged, fewer drops) and less frame-timing jitter.

That is ~15% off the ~370 ms baseline glass-to-glass. The client playout
buffer remains the largest single remaining term (baseline p50 364 ms with
only ~85 ms of it in the receiver's de-jitter buffer), which keeps the
Phase 2 playout-delay experiment as the highest-value next lever.

**CI note (2026-08-03):** the `robot-face-review-gate` timed out on every
build of this PR (1200 s, `review_state: reviewing`, zero findings,
`timed_out: true`). It is NOT a review objection and NOT specific to this
PR — PRs #1966 and #1967 show the same failure the same night, i.e. Codex
is not completing reviews repo-wide. Retry the gate job once Codex
recovers; do not treat the red as a code signal.

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
- [x] Phase 1 live A/B acceptance run, numbers recorded above (PR #1965
      ready for review; encoder isolation −31.2 ms, glass −54.5 ms,
      server-side −58.3 ms).
- [ ] Retry `robot-face-review-gate` on PR #1965 once Codex recovers (it
      timed out repo-wide the night of 2026-08-03 — see the CI note).
- [ ] Phase 2 experiment session; adopt/reject recorded here.
- [ ] Phase 3 metric repair + todo archival.
- [ ] Phase 4 freeze-attribution session.
- [ ] Phase 5 4P stress measurement → follow-up plan.

## Session Log — 2026-08-03

### Done

- Shipped Phase 1 as PR #1965 (ready for review, 8 commits): VAAPI
  `asyncDepth`, `lowLatencyMux`, `lowDelayAudio` opt-ins in the fork (with
  assert-default tests protecting streambot/pokemon), MK64 config knobs,
  immediate button-edge emit in the frontend, and the four instrumentation
  additions.
- Ran the full live acceptance on the production pod: built and pushed the
  candidate image, deployed by digest under an Argo hold, and measured both
  arms. **Tier 1 delivers ~55 ms at the player's eye** (95% CI [−63, −47]),
  corroborated by a −58 ms server-side delta and a −31.2 ms in-pod encoder
  isolation for `async_depth` alone.
- Settled the desync investigation: the new depth gauge reads a standing
  34-36 with inflation tracking `depth x frame-interval`, proving phantom
  head entries.
- Built a much better ruler: the in-page canvas glass probe (~20 samples/s,
  no capture-window uncertainty) replacing the 2.8 samples/s screenshot rig,
  plus the receive-side `getStats` poller.
- Restored the cluster exactly: declared image `2.0.0-7794`,
  `syncPolicy.automated = {enabled: false}` matching the release policy and
  sibling apps, `Synced / Healthy`; temp driver, in-pod script, PinchTab
  instance and port-forwards all removed.

### Remaining

- Retry the review gate when Codex recovers (repo-wide outage, not a code
  signal).
- Phase 2 experiments — now the highest-value work, since the client playout
  buffer is the largest remaining term (~364 ms baseline p50).
- Phase 3 metric repair (mechanism now confirmed), Phase 4 freeze
  attribution, Phase 5 4P gate.

### Caveats

- The glass A/B is one session per arm; its CI covers within-session noise,
  not between-session client-playout variance (observed 68-370 ms). The
  three-method agreement is what makes the result credible, not the CI alone.
- The 68.5 ms low-latency playout state was observed once and never
  reproduced on demand; understanding how to force it would be worth more
  than any remaining server-side tuning.

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
- 2026-08-03: **Course correction — the session had been measuring the wrong
  quantity.** Every ruler built up to this point (glass probe, viewer-stats,
  in-pod encoder isolation) measures the _video path_: how long a frame takes
  to reach a viewer. None of them involve an input. The user's goal is input
  lag, so a real press-to-glass ruler was built and the earlier conclusions
  were re-derived against it.

  **Method.** `scripts/e2e-press-to-glass.ts` claims a real seat over the
  production socket.io path and issues press/release edges, logging the
  epoch-ms of each emit. In the Discord viewer tab, a
  `requestVideoFrameCallback` loop decodes the burned-in HUD out of every
  _presented_ frame — not a polling cadence, so the transition frame is never
  missed. The HUD lights seat N's digit on the first frame the emulator
  rendered while holding that seat's input, and carries the pod's capture
  timestamp, so each press yields a full decomposition. `press -> on screen`
  is skew-free (both ends are the Mac's clock); only the split between the
  input leg and the video leg depends on the pod clock offset.

  **Measurement validity.** 100% of frames decoded with exact (Hamming-0)
  glyph match; calibration score 0; `u = 1.5` exactly as the framebuffer
  geometry predicts. A gate rejects any rise not pinned to a single presented
  frame (`riseGap == 1`). Pod clock offset pinned by NTP-style round trip on
  an established exec stream: **18.54 ms ± 0.54** (best RTT 1.09 ms, offset
  stable to 0.68 ms across the five fastest exchanges), re-measured later at
  16.35 ms on a different pod — so **clock drift is ruled out** as an
  explanation for the decay below. `callbackToGlass` comes out quantised at
  vsync multiples (16.7 / 33.4 ms), which is what physics requires and
  independently validates `expectedDisplayTime`. Receive-side getStats run
  concurrently reports `meanJitterBufferMs 92` against a measured
  `recvToCallback` of ~117-122 ms — consistent, since our window additionally
  contains decode and delivery.

  **Result (single player, in Discord, n=120/run).**

  | Segment                                         | settled     | fresh stream |
  | ----------------------------------------------- | ----------- | ------------ |
  | input path (press → emulator renders the frame) | ~35 ms      | ~35 ms       |
  | pod → last packet at browser                    | ~50 ms      | ~250 ms      |
  | browser jitter buffer + decode                  | ~52 ms      | ~150 ms      |
  | wait for a vsync                                | ~29 ms      | ~17 ms       |
  | **press → on screen**                           | **~172 ms** | **~500 ms**  |

  Add MK64's own internal reaction (~66-133 ms, not measured here) for felt
  lag.

  **Two findings change the plan's priorities.**
  1. _The input path is not the problem._ It is ~35 ms and dead flat across
     every condition — fresh stream, settled stream, whole 4-minute run. The
     frontend coalesce removal and other input-side work is done; there is
     nothing material left to win there. All remaining lag is video path.
  2. _Stream age is a first-order confound and a first-order lever._ Input
     lag decays monotonically ~500 → ~200 ms over the first 4+ minutes of a
     stream and had not bottomed out when the run ended. Two identical runs
     minutes apart in the same session measured 291 ms and 172 ms. **Any A/B
     not matched on stream age measures the age, not the change** — which
     retrospectively explains the earlier "301 ms win" artifact. It also means
     a player who `/play`s and races immediately feels 2-3x the settled lag.

  **Ruled out for the decaying pod→browser leg:** clock drift (skew
  re-verified stable); retransmission (getStats: 0 packets lost, 0 NACKs, one
  198 ms freeze in 5 min); ffmpeg input backpressure
  (`stream_frame_write_ms` = 0.25 ms throughout); sub-realtime encode
  (`stream_ffmpeg_speed_ratio` ≈ 1.000, the one 0.93 reading was a startup
  transient). Root cause not yet identified — the in-pod
  `stream_packet_ready_delay_ms` histogram is pinned at its top bucket
  (2500 ms), the known Phase 3 corruption, so it cannot localise the queue.
  **Repairing that histogram (Phase 3) is now the blocker for attributing
  ~200 ms of fresh-stream lag.**

  **Shipped this session:** `video_playout_delay_max_ms`. The fork advertises
  `playout-delay` max = 100 ms and Chrome sits at that ceiling (92 ms
  measured) on a link with zero loss, so the advertised cap is close to a
  floor on client-side delay. Now configurable, opt-in, defaulting to the
  historical 100 ms so streambot/pokemon are untouched. **Not yet A/B'd** —
  it must be tested at matched stream age.

- 2026-08-03: **Bug found while running the rig: `/stop` bricks the bot.**
  Reproduced three times. On session end the stream account's selfbot client
  fails to tear down (`selfbot client destroy failed (ignored)`:
  `null is not an object (evaluating 'this.connection.readyState')` in
  `WebSocketShard.destroy`), and the emulator worker is left stopped
  (`emulator reset after stream session failed: emulator worker is not
running`). Every subsequent `/play` then replies "Starting Mario Kart 64 in
  Voice" and never goes live — `stream_active` stays 0 and the account never
  joins voice. Only a pod restart recovers it. Two separate faults: the
  unrecoverable client state, and `/play` reporting success when it cannot
  stream (a fail-fast violation — it should surface the dead gateway). Not
  fixed here; filed as `packages/docs/todos/mk64-stop-bricks-stream-account.md`.

## Session Log — 2026-08-03 (press-to-glass)

### Done

- Built and validated a real input-lag ruler after establishing that every
  prior measurement in this plan was video-path only, not input lag.
  `packages/discord-plays-mario-kart/packages/backend/scripts/e2e-press-to-glass.ts`
  (input half) plus a `requestVideoFrameCallback` HUD decoder that samples every
  presented frame (analysis harness in the session scratchpad).
- Measured press-to-glass, single player, in Discord: **~172 ms settled,
  ~500 ms on a fresh stream**, decomposed into input path / pod→browser /
  client buffer / vsync. Charted the decay (attached to PR #1973).
- Validated the measurement: exact glyph decode, single-frame rise gate, NTP
  round-trip clock skew (18.54 ± 0.54 ms, re-verified), vsync quantisation of
  `expectedDisplayTime`, and concurrent getStats corroboration of the client leg.
- Ruled out clock drift, retransmission, ffmpeg input backpressure, and
  sub-realtime encode as causes of the decaying pod→browser leg.
- Shipped `video_playout_delay_max_ms` (fork opt-in + mario-kart config),
  defaulting to the historical 100 ms so no consumer changes behavior.
- Filed `packages/docs/todos/mk64-stop-bricks-stream-account.md`.
- PR #1973 (draft, git-spice, off the new main after #1965 merged mid-session).

### Remaining

- **A/B `video_playout_delay_max_ms` 100 → 30 at matched stream age.** This is
  the first change the new ruler can properly evaluate, and the client buffer
  is ~92 ms of a ~172 ms settled budget. Requires a candidate image, deploy by
  digest, and two runs started at the same stream age.
- **Phase 3 metric repair is now the blocker for the biggest unexplained term.**
  `stream_packet_ready_delay_ms` is pinned at its top bucket, so ~200 ms of
  fresh-stream pod→browser latency cannot be localised to encode, packetize,
  pacer, or SFU.
- Understand and fix the startup decay itself — a player who `/play`s and races
  immediately gets 2-3x the settled lag.
- Phase 4 freeze attribution, Phase 5 4P gate (unchanged).

### Caveats

- The settled figure (~172 ms) comes from runs that had not finished decaying;
  the true floor may be lower. Runs were 4 minutes.
- `press → HUD digit lit` deliberately excludes MK64's own internal reaction
  (~66-133 ms). It measures the part of the budget this system controls; felt
  lag is higher.
- `/stop` bricks the stream account, so every session cycle in this work used
  a pod restart instead. `scratchpad/start_stream.sh` encodes that.
- The A/B in the earlier Comment Log entries was measured with the video-path
  ruler. Those numbers are not wrong, but they are not input lag, and the
  stream-age confound means their confidence intervals understate uncertainty.
