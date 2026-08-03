---
id: log-2026-08-02-mk64-input-lag-attribution
type: log
status: complete
board: false
---

# MK64 input-lag attribution — per-component measurement

## Request

Perceived input lag on mariokart.sjer.red is very noticeable despite decent
framerate and audio latency. Measure each individual pipeline component so the
cause can be attributed, including the actual Discord viewing experience
(user-approved scope), and record a per-segment latency table.

## Method

Live session against production image `2.0.0-7749` (includes #1779), fully
agent-driven:

- **Viewer**: PinchTab headed Chrome, persistent `discord-latency-poc` profile
  (already logged in as the throwaway user), joined the `Diamond Dudes` Voice
  channel via the web client, invoked `/play` from the message box (Glitter
  Kart 64's command), clicked Watch Stream, switched to theater view.
- **Input driver**: temporary Bun script over the public path
  (`socket.io-client` → mariokart.sjer.red): RTT pings, `seat-claim`, a 60 s
  5 Hz A-toggle phase to fill the passive histograms, then 12 discrete 700 ms
  presses at 3 s spacing with Mac-epoch timestamps.
- **Server side**: `/metrics` scraped through a port-forward before/after each
  phase; bucket-delta quantiles computed offline (linear interpolation, not
  bucket-boundary upper bounds).
- **Glass side**: ~2.8 fps CDP tab screenshots (402 shots / 130 s), each
  timestamped locally; the #1128 overlay decoded per shot with the exact 5×7
  HD44780 glyph tables + brute-force scale/origin fit (final calibration
  score 0 — every glyph matched exactly). Sky defeats grayscale thresholds;
  min(R,G,B) isolates the white-on-black overlay.
- **Clock alignment**: pod clock leads the Mac by ~19.3 ms (streamed
  `Date.now()` samples over kubectl exec, spread 1.5 ms).

## Results — the attribution table

Values below incorporate the 2026-08-03 five-agent adversarial review
(decoder-verification, statistics audit, methodology bias audit, devil's
advocate, desync code review) — see "Review corrections" further down.

| Segment                                       | Source                                                                      | Result                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A. Browser → backend (one-way)                | driver RTT median 11.9–14.1 ms                                              | **~6–7 ms** (raw socket, LAN)                                                         |
| B. Receipt → emulator latch                   | `emulator_input_apply_delay_ms` (fine buckets, trustworthy)                 | **9.5 ms mean / 22.5 ms p95**                                                         |
| C1. Latch → rendered frame                    | `emulator_frame_emulate_ms` 11 ms mean + copy 0.1 ms, ≤ 33 ms tick boundary | **≤ ~33 ms**                                                                          |
| C2+C3. Frame → encoded → RTP sent             | histograms unusable (see finding 2); bounded by glass result                | **small (≲ 100 ms)**                                                                  |
| D. Overlay stamp → Discord SFU → viewer glass | corrected glass-to-glass (see below); viewer voice ping 5 ms                | **≈ 50–170 ms (hard floor ≥ 48 ms mean)**                                             |
| **Total press → glass**                       | HUD seat digit in viewer screenshots vs press epochs                        | **central ~100–150 ms; rigorous bracket [≥80, ≤296] ms mean (n=12, cadence-limited)** |
| Game reaction (inherent)                      | MK64 logic at 30 fps                                                        | +2–4 game frames (+66–133 ms) on top                                                  |

Glass-to-glass correction (statistics audit): the published preliminary
"mean 7 ms / p50 4 ms" was a broken estimator — 45% of samples were negative
(physically impossible; you cannot photograph a frame before it is stamped).
The capture-must-follow-stamp constraint pins the CDP capture instant at
≥0.63 into the ~330 ms HTTP window, and the 19.3 ms clock offset is itself a
lower bound (unmeasured kubectl-exec one-way transit adds ~5–30 ms). Corrected
G2G: **mean ≥ ~48 ms, central ~50–170 ms, up to ~200 ms**. The qualitative
conclusion (sub-200 ms, nowhere near seconds) stands; "effectively realtime"
was an overstatement. Dominant error: the ~330 ms capture window.

Honest range for a REAL player (methodology audit): the table is a best-case
LAN/raw-socket floor. The real controller page adds a 16 ms input-coalescing
timer (`frontend/src/app.tsx`) plus device input latency (mobile touch
30–80 ms); remote players add their RTT and a larger adaptive Discord jitter
buffer (+100–250 ms vs the collapsed same-LAN case); CDP screenshots exclude
the viewer's display pipeline (+16–40 ms). Expected felt press→kart-reacts:
**~190–260 ms on LAN, ~320–580 ms remote**. Operator report (2026-08-03):
noticeable lag on LAN 1P, substantially worse with 4 players — consistent
with these numbers and with the untested 4-player regime below.

## Finding 1 — the pipeline is NOT the source of seconds-scale lag

On current main the true budget is ~100–150 ms press-to-glass (LAN floor)
plus the game's own reaction frames — felt ~190–260 ms on LAN. Sub-second,
and noticeably laggy for a racing game, but nowhere near the seconds-scale
regime of the pre-#1779 era (half-speed emulation + 1 s+ startup backlog were
real then). Two regimes remain unmeasured and are the prime suspects for
"substantially worse" reports: (a) 4-player split-screen under the software
angrylion renderer — if `emulator_frame_emulate_ms` (11 ms at 1P idle)
crosses the 16.7 ms VI budget under 4P load, game time itself runs
sub-realtime, which feels like severe input lag (MK64 also has a documented
native multiplayer slow-motion quirk); (b) real remote players' input/viewer
legs.

## Finding 2 — the #1779 latency histograms are lying (correlation bug)

The passive metrics reported absurd values during the same session in which
the viewer showed realtime delivery:

- `stream_packet_ready_delay_ms{video}` mean 1174 ms (pre→post window),
  1010 ms (post→post2); `stream_input_to_send_complete_ms` mean ~1215 ms;
  `stream_av_content_offset_ms` −99…−163 ms.
- Physically impossible: a frame whose packet takes 1.2 s to encode cannot be
  on the viewer's glass 50 ms after its overlay stamp. Press→stamp (~130 ms
  incl. sampling) also rules out any pre-stamp delay.

Mechanism (corrected 2026-08-03 after adversarial review): the pairing is
FIFO and 1:1-assuming (confirmed), and sink evictions cannot desync it
(confirmed) — but the originally-hypothesized shift source, **ffmpeg CFR
drop/dup, is REFUTED**: the exact command shape emits exactly one packet per
input frame under every arrival pathology tested (8 profiles, empirical).
The corrected hypothesis is a **standing ~30-frame pairing offset formed
once near session startup on the production path** — leading suspects:
packets produced before the voice/RTP session attaches being discarded
without reaching `onPacketReady` (~1 s handshake ≈ 30 frames whose sources
then poison the FIFO head), or h264_vaapi-specific startup packet behavior
(untested locally). The bucket-level recheck makes the contradiction
airtight: all 25 input observations in the fully glass-observed phase-2
window read ≥1000 ms while the same presses reached glass in 35–330 ms.
The A/V content-offset gauge is separately untrustworthy (duration-pairing
drift on the audio side; it swung −162 → +710 ms in one session). The #1779
live acceptance ("−198.5 ms A/V offset") most likely measured these
artifacts, not real skew.

Fix direction (per review): decisive instrumentation first — a
`videoSources`-depth gauge + delivered/emitted counters (phantom head
entries vs real backlog in one look) — then close the identified 1:1 break;
naive PTS pairing alone is a no-op on an intact stream. Tracked in
[`mk64-stream-latency-correlation-desync`](../todos/mk64-stream-latency-correlation-desync.md).

Secondary observation: `stream_ffmpeg_speed_ratio` read 0.92 sustained
mid-session but 1.27 at session end — the timemark-derived gauge is noisy;
don't treat sustained ≈0.9 as proof of sub-realtime encoding without an
independent check (ffmpeg held 29.9–30.04 fps with zero late sends
throughout, 59 631 frames / 0.1% dropped over the 33-minute session).

## Measurement boundary map (from code, for future sessions)

- `availableAtMs` is stamped at `pushFrame` (main thread) and recorded into
  the tracker on sink **delivery**; the overlay clock is stamped in the same
  frame path, so overlay-clock G2G measures push→glass.
- `emulator_input_apply_delay_ms` uses an absolute cross-thread clock
  (`performance.timeOrigin + performance.now()`), comparable across Worker
  and main thread.
- `e2e:stream-latency` (flash/chirp) is synthetic/ROM-free, software encoder;
  it validated ±100 ms injected offsets within ~1 ms at baseline. It exercises
  the same `StreamLatencyTracker`, but with a fixed synthetic cadence that
  never triggers ffmpeg drop/dup — which is why it passes while production
  numbers are corrupted.
- Viewer-side automation: PinchTab profile `discord-latency-poc` retains the
  Discord web login; slash commands work via keystroke events into the
  message box (`kind: "press"` per char, then Enter to select + Enter to
  send — synthetic `type` into the Slate editor does NOT register). Tab
  endpoints: `POST /tabs/{id}/evaluate {expression}`, screenshots ~350 ms
  each. Chrome throttles fully-occluded windows; keep the window partially
  visible or diff-check liveness before trusting captures.

## Review corrections (2026-08-03, five-agent adversarial review)

User-directed review fan-out; verdicts:

- **Decoder verification**: zero mismatches in ~360 manually-read glyphs +
  160 seat-flag slots; all 402 shots exact-match (Hamming 0) with ≥6-bit
  margins; seat detection perfectly bimodal (4 vs 10 lit dots); 12/12 presses
  reproduced against the driver log. The three clock-jump anomalies
  (463/534/700 ms at shots k166–168, k180–182, k372–373) are REAL stream
  stutters faithfully decoded — a genuine latency-tail signal (they inflate
  Discord's adaptive viewer buffer).
- **Statistics audit**: every published number reproduces exactly; no script
  bugs. Two estimator corrections applied above (G2G floor ≥48 ms; press→
  glass re-framed as [80, 296] ms bracket). Coarse-bucket histogram
  "quantiles" (1750/2425 ms) must never be quoted — 100% of observations sat
  in the single (1000, 2500] bucket; only means are meaningful, and only as
  corruption evidence.
- **Methodology bias audit**: press-to-glass is skew-independent and brackets
  the whole pipeline (strength); G2G excludes emu render + worker hop
  (~15–40 ms). Biggest gaps: same-LAN viewer collapses the adaptive jitter
  buffer, raw-socket driver skips the controller page's 16 ms coalesce +
  device latency, and the 4P/software-render regime was never exercised.
- **Devil's advocate**: every alternative story in which ≳0.5 s latency is
  real dies on the evidence. Strongest new proofs: the overlay stamp is
  burned and `pushFrame` called in one synchronous callback BEFORE any queue
  (`mario-kart-driver.ts:176-184`); `MAX_BUFFERED_FRAMES=3` architecturally
  caps real in-sink residency at ~100 ms; `av_content_offset` swung
  −162 → +710 ms in one session (physically impossible → corrupted
  correlation); the inflation quantum tracked 35.2 → 30.2 frame-times across
  windows with zero new drops (standing-FIFO-offset signature).
- **Desync mechanism review**: REFUTED the published CFR drop/dup mechanism
  (empirical 1:1 frame↔packet across 8 arrival pathologies for this exact
  command shape; `-r 30` on counted rawvideo PTS is a bijection; no
  `fps=`/`vsync` in the fork) while CONFIRMING the FIFO structure and
  eviction safety, and locating the observer emission points
  (`LibavDemuxer.ts:313/328`, `BaseMediaStream.ts:173-184`; measured C3≈0
  rules out parse-lag). Follow-up bucket recheck then proved the
  contradiction inside the fully-observed window (25/25 input observations
  ≥1 s vs glass 35–330 ms), which redirects the mechanism to a
  startup-formed standing offset (pre-attach packet discard or VAAPI
  startup behavior) — todo rewritten accordingly, with a
  `videoSources`-depth gauge as the decisive first step.

## Follow-ups

- [`mk64-stream-latency-correlation-desync`](../todos/mk64-stream-latency-correlation-desync.md)
  — fix the FIFO pairing so the histograms tell the truth.
- Human acceptance: a real multi-player session on 2.0.0-7749 to confirm feel;
  if lag persists for remote players, measure THEIR controller RTT
  (`controller_rtt_ms` now populates from real clients).
- The `/stop` teardown race fired again (`emulator worker is not running`),
  exactly as tracked in `mk64-worker-session-stop-reset-order` — unchanged.

## Session Log — 2026-08-02

### Done

- Measured every pipeline segment live against production (table above):
  press→glass p50 ≈ 124 ms upper bound; A ≈ 6 ms, B ≈ 10 ms, C1 ≤ 33 ms,
  Discord leg ≈ 50–200 ms.
- Built and validated a fully automated Discord viewer measurement rig:
  PinchTab web client joins voice, invokes `/play`, watches the stream in
  theater; 402 timestamped screenshots decoded against the #1128 overlay with
  exact-glyph matching (calibration residual 0).
- Proved the #1779 passive latency histograms are inflated ~30–35 frame-times
  by a FIFO correlation desync (physics + counter-quantum + code reading);
  filed `mk64-stream-latency-correlation-desync`.
- Ran the synthetic `e2e:stream-latency` calibration on current main
  (software path A/V offset −1.0 ms p50) and explained why it can't catch the
  production desync.
- Measured Mac↔pod clock skew (pod +19.3 ms, ±1 ms) and viewer voice ping
  (5 ms).
- Clean teardown: `/stop` (session summary logged: 30 fps, 0.1% drops, zero
  late sends), voice disconnected, PinchTab instance stopped, port-forward
  killed, temp driver script deleted, Argo untouched (read-only session).

### Remaining

- Fix the tracker desync (todo above) and re-run this session's passive
  measurement to confirm honest numbers.
- Human play test on 2.0.0-7749 to re-evaluate perceived lag now that the
  pipeline measures ~realtime; capture `controller_rtt_ms` from real remote
  players in the same window.

### Caveats

- Press→glass is quantized by the ~300 ms screenshot cadence (all quoted
  values are upper bounds; true p50 likely 60–120 ms). A higher-rate capture
  (window-id `screencapture` loop or in-page WebCodecs tap) would tighten it.
- My driver ran on-LAN (12 ms RTT); remote players add their own network leg.
- The 60 s toggle phase pressed A ~300 times and navigated the live game into
  a real Grand Prix race — harmless, but future runs should idle in attract
  mode or use a neutral button if game-state matters.
- Screen-region ffmpeg recording of a shared desktop proved unusable while
  the operator works the machine (window occlusion/movement); the CDP
  tab-screenshot approach is immune and is the pattern to reuse.

## Session Log — 2026-08-03 (adversarial review + burn-down research)

### Done

- Ran the user-directed five-agent adversarial review of the measurement
  (decoder, statistics, methodology, devil's advocate, desync mechanism);
  applied the corrections above. Core conclusions survived; G2G and
  press→glass estimators were corrected, and honest LAN/remote player ranges
  were added.
- Captured the operator's ground truth: noticeable lag on LAN 1P today,
  substantially worse at 4P.
- Strategy set with the user: **in-Discord only, single-player first**
  (no in-page driver feed for now; 4P deferred — "if 1P isn't right, 4P is
  hopeless"). Input-echo/perceived-lag tricks rejected (players watch the
  game, not UI); run-ahead rejected (needs 2× headroom that 4P lacks).
- Launched a six-agent research fan-out on in-Discord latency reduction:
  Go-Live viewer-buffer internals, camera-mode-vs-Go-Live path, fork
  send-path buffer inventory, ffmpeg/VAAPI encode chain (incl. NUT
  dual-input interleave question), emulator input-latch timing (60 Hz VI
  latch / PIF-poll injection), and stutter root-causing (the 463–700 ms
  hitches that inflate the adaptive viewer buffer).

### Remaining

- Execute
  [`plans/2026-08-03_mk64-in-discord-latency-burn-down.md`](../plans/2026-08-03_mk64-in-discord-latency-burn-down.md)
  — the six research reports are synthesized there (Tier 1 ship list,
  Tier 2 A/B gambles, the getStats-based ruler, sequencing).
- Desync mechanism verdict is folded into
  `mk64-stream-latency-correlation-desync` (done 2026-08-03); the depth
  gauge rides in the plan's PR 1.
- After 1P ships: the 4P stress measurement (separate plan per the
  burn-down doc).

### Caveats

- All quoted latencies are LAN-floor numbers unless labeled otherwise; the
  remote-player range (~320–580 ms felt) is model-derived, not yet measured.
- In-Discord constraint puts a ~60–100 ms floor under the viewer leg; the
  75% felt-lag goal is not reachable within it (halving is realistic).

## Workflow Friction

- `pinchtab-helper` documents CLI shorthands but not the REST specifics this
  session needed: action schema is `{"kind": "click|type|press", ...}`,
  per-tab eval is `POST /tabs/{id}/evaluate {"expression"}` (NOT an action
  kind), and shorthand commands can route to a stale default tab. Worth
  adding to the skill.
- Discord's Slate message box ignores synthetic `type` input; per-character
  `press` key events work. Now recorded above for reuse.
