---
id: plan-2026-08-03-mk64-in-discord-latency-burn-down
type: plan
status: planned
board: true
verification: agent
disposition: active
---

# MK64 in-Discord latency burn-down (single-player first)

> Execution tracking lives in
> [`2026-08-03_mk64-latency-full-surface.md`](2026-08-03_mk64-latency-full-surface.md)
> (the approved implementation plan); this document remains the research
> synthesis and adopt/reject evidence record.

## Constraints (user-set 2026-08-03)

- Discord stays the only video path (no in-page driver feed for now).
- Single-player first; 4-player deferred until 1P is right.
- No UI-echo tricks (players watch the game); no run-ahead (needs 2× headroom
  that 4P lacks).

## Current honest budget (LAN 1P, from the reviewed 2026-08-02 measurement + six-agent research)

| Leg                          | ms                      | Notes                                                                                               |
| ---------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| Browser coalesce + socket    | ~14 (8+6)               | 16 ms coalesce timer in `frontend/src/app.tsx:40`                                                   |
| Backend receipt → VI latch   | ~9.5 mean               | already optimal (60 Hz latch, poll-on-demand at SI read)                                            |
| Game reacts (in-emulator)    | ~58 mean / 33 floor     | MK64's own lag frame + 30 Hz cadences; not reducible in-host                                        |
| Encode chain (stdin→NUT out) | ~45–90                  | async_depth 2 ≈ 33 ms of it; filters ~5; mux/IO ~5–20                                               |
| Pacing (sleep + wire pacer)  | ~16–40                  | PTS pacing 0–33 by design; keyframe wire-spread 20–32                                               |
| Discord leg                  | ~35–80 good, ~170+ tail | audio-synced NetEq pull-up 15–50; tail = adaptive-buffer inflation from downstream-injected freezes |
| Player display               | 16–40                   | their screen                                                                                        |
| **Felt total**               | **~210–360**            | press → kart visibly reacts                                                                         |

Realistic post-plan outcome: **~160–280 ms felt** (pipeline ~90–150 + game
66–133). The in-Discord floor (≈60–100 ms Discord leg + game reaction) makes
the original 75%-cut goal unreachable within these constraints; ~half is the
honest target.

## Tier 1 — ship without further debate (~40–60 ms, all low-risk)

1. **`-async_depth 1`** — `packages/discord-video-stream/src/media/vaapi.ts:63`
   options array. ~33 ms (empirically-grounded: VAAPI default 2 holds one
   frame in the encode FIFO; ffmpeg source-verified). Needs prod A/B to
   confirm fps holds 30.0 (encoder runs ~16× realtime; safe). Bonus: less
   encode jitter → smaller adaptive viewer buffer.
2. **Kill the 16 ms input coalesce for button edges** —
   `packages/discord-plays-mario-kart/packages/frontend/src/app.tsx:40,111-151`.
   Emit keydown/keyup immediately; keep coalescing analog-stick movement.
   ~8 ms mean.
3. **`-flush_packets 1`** on the NUT output —
   `packages/discord-video-stream/src/media/newApi.ts:370-376`. 0–5 ms tail
   guard; doc-endorsed; empirically harmless.
4. **Opus low-delay** — `-application lowdelay -frame_duration 10` at
   `newApi.ts:899`. ~10–16 ms on the audio path; shrinks the A/V-sync
   pull-up that gates video at the viewer (audio-master NetEq).

Explicitly rejected (evidence): `-max_interleave_delta 0` (empirical: no
steady-state effect + unbounded-buffering footgun), 60 fps output (game
renders 30 fps content; no info ships earlier; risks emulator budget),
sink 3→2 frames (~0 steady-state), pacing-sleep removal (moves the buffer
into Discord's jitter buffer and breaks smoothness), 60 Hz input latch
(already implemented), mid-VI wasm injection (few ms, high effort),
run-ahead, UI echo.

## Tier 2 — measured gambles (A/B each against the new ruler; adopt on evidence)

5. **playout-delay hint 100→30 ms** —
   `packages/discord-video-stream/src/client/voice/WebRtcWrapper.ts:193`
   (`playoutDelayMax` 10→3). Tens of ms IF Discord's client honors it;
   under-buffering risk → watch freezeCount. One line, env-gated.
6. **Wire pacer 25→50 Mbps** — `WebRtcWrapper.ts:215`. Keyframe spread
   20–32→10–16 ms. LAN-safe; watch NACKs off-LAN.
7. **Camera-mode A/B** — `game-streamer.ts:273-278` `{type:"camera"}`,
   env-switchable. Delta unknown (fork already requests ≤100 ms playout on
   both modes). Adopt only on a consistent ≥150–200 ms win AND acceptance of
   the product changes (always-visible tile; game audio becomes bot voice
   heard by all VC members).
8. **Audio-decoupling experiment** — stream video-only for one session;
   measures the A/V-sync pull-up (~15–50 ms est.). If large, decide
   product-wise (silent stream vs latency).

## The new ruler (build alongside Tier 1 — every A/B needs it)

- **Receive-side WebRTC getStats poller** inside the PinchTab Discord viewer
  tab (CDP eval, ~250 ms cadence): `jitterBufferDelay`, `freezeCount`,
  `totalFreezesDuration`, `packetsLost`, `framesDecoded`,
  `estimatedPlayoutTimestamp`. Zero pod changes; replaces screenshot
  quantization for the Discord leg; directly attributes freezes
  (client-buffer vs network vs render) — the 2026-08-02 freezes were proven
  downstream-injected (pod fully exonerated: send intervals ≤8 ms of budget,
  0 CFS throttling).
- **Pod-side gap-closers**: manual event-loop-lag histograms on main +
  worker (Bun's `monitorEventLoopDelay` empirically does not detect sync
  blocks — use a 20 ms setInterval sampler), fine-bucket
  `stream_send_interval_ms`, and the `videoSources`-depth gauge from
  [`mk64-stream-latency-correlation-desync`](../todos/mk64-stream-latency-correlation-desync.md)
  so the passive histograms become trustworthy again.

## Sequencing

1. PR 1: Tier 1 items + the ruler (getStats poller script + pod gap-closer
   metrics) + the desync depth-gauge. Live A/B: async_depth on/off.
2. Session: run Tier 2 experiments (5–8) one at a time against the ruler;
   adopt winners.
3. Then the deferred 4P stress measurement (separate plan; emulate p95
   ~25–30 ms already flirts with the 16.7 ms VI budget — 4P/software-render
   likely goes sub-realtime, which is game-time slowdown, not input lag).

## Remaining

- [ ] PR 1 (Tier 1 + ruler + depth gauge) with live A/B evidence.
- [ ] Tier 2 experiment session with adopt/reject decisions recorded here.
- [ ] 4P stress measurement plan after 1P ships.

## Comment Log

- 2026-08-03: Plan synthesized from the five-agent adversarial review of the
  2026-08-02 measurement plus six research agents (Go-Live internals, camera
  mode, send path, encode chain, emulator input, stutter forensics). Key
  evidence: fork already sets playout-delay ≤100 ms on both modes; input
  already latches per-VI; pod exonerated for freezes; interleave-flag
  folklore empirically busted; async_depth=2 confirmed as the dominant
  server-side lever.
