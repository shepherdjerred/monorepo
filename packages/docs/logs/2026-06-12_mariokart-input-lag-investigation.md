---
id: log-2026-06-12-mariokart-input-lag-investigation
type: log
status: complete
board: false
---

# mariokart.sjer.red — "massive input lag" during multiplayer session investigated

## Report

User played MK64 with friends via the web controllers + Discord Go-Live stream and hit
"absolutely massive input lag". Investigated the full pipeline using the observability shipped in
PR #1101.

### Session identified

`stream_active` shows the session: **2026-06-07, ~21:55–22:34 PT** (three mario-kart pod
generations: `55c5cc6f89-fkpz5` → `b9b66b5-4cnhg` → `b9b66b5-s8m74`; pokemon streamed in the same
window). All metric queries below cover 2026-06-08T04:50Z–05:40Z.

### Server-side: healthy

| Signal                                          | Result                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Achieved FPS (`rate(emulator_ticks_total[1m])`) | **flat 30.0** the entire play window (dips to ~12 in coarse 7d queries are pod start/stop rate artifacts) |
| `emulator_frame_emulate_ms`                     | p50 ~13ms, p95 ~42ms vs 33ms budget — occasional over-budget frames but no sustained slip                 |
| `emulator_frame_late_ms` p95                    | avg ~11ms, max ~33ms (jitter only)                                                                        |
| `emulator_loop_resync_total`                    | 0 — never fell >250ms behind                                                                              |
| `stream_sink_buffer_bytes`                      | flat 0 — ffmpeg/encode path never backed up                                                               |
| CPU CFS throttling (mario-kart + pokemon)       | 0 throughout; pod used ~0.7–0.95 cores; node peaked 92% busy but never saturated                          |
| Loki: frametime/backpressure warnings           | none                                                                                                      |

Input path (browser → Socket.IO → dispatch → wasm latch) is tens of ms: Cloudflare-tunnel RTT +
≤33ms tick-boundary alignment. Encoder already runs latency-lean: `-bf 0`,
ultrafast/zerolatency (sw) or VAAPI VBR (hw), `-fflags nobuffer`, 1s keyframes.

### Conclusion

The lag does **not** originate in the backend pipeline. The unmeasured segment — Discord Go-Live
ingest + viewer-client buffering — is the only place left, and it is the players' _only_ video
feedback (the controller page has no video). Go-Live is a screen-share product with seconds-scale
viewer buffering; button → game reaction is ~50–100ms server-side, but players can't _see_ the
reaction until the frame round-trips through Discord. Perceived input lag ≈ Discord glass-to-glass
latency.

### Remediation step 1 (this session): timestamp overlay

Shipped a capture-time UTC wall-clock overlay
(`packages/discord-plays-mario-kart/packages/backend/src/stream/overlay.ts`): every streamed frame
is stamped `UTC HH:MM:SS.mmm` (white-on-black 5×7 bitmap font, top-left, drawn 2× wide to come out
square on the horizontally-doubled 640×240 framebuffer). Wired in the `onFrame` → `pushFrame` path
only (`src/index.ts`), so `/screenshot` stays clean. Dependency-free, clip-not-throw on odd VI
modes.

**To measure:** watch the Go-Live stream next to `date -u` (or any ms UTC clock, e.g.
time.is/UTC). On-screen clock minus real clock = glass-to-glass latency at that moment.

### Step 2 (future, if step 1 confirms Discord is the lag)

Low-latency video feed in the web controller itself — WebRTC from the backend, or
H.264-over-WebSocket via WebCodecs (frames are already BGRA buffers in `pushFrame`). Discord
stream remains for spectators. Discord-side tuning has little headroom left.

## Post-deploy measurement runbook

Once PR #1128 is deployed (remember the chart/image lag — confirm a catch-up build published a
chart embedding the new image):

1. Start a stream (join the voice channel), claim a seat, hold a button.
2. **Glass-to-glass:** compare the on-stream `UTC HH:MM:SS.mmm` clock against `date -u` /
   time.is/UTC. The difference is the Discord viewer latency.
3. **Press→glass:** screen-record the stream while pressing a button; ms from keypress to the seat
   digit lighting in the HUD (`UTC … 1..4`) is the full perceived input lag.
4. **Metrics (Grafana → "Discord Plays — Stream Health", new rows):** input apply delay p95,
   controller RTT p50/p95, ffmpeg speed ratio (<1 sustained = encode-bound), send frametime ratio
   p95 + late sends, frame push interval/write p95.
5. **Loki:** one `ffmpeg command` line per session start, `stream session summary` on stop
   (frames, late %, last speed ratio); rate-limited warn if encode runs sub-realtime.
6. Attribution: anything not accounted for by the above segments is Discord ingest + viewer
   buffering.

## Session Log — 2026-06-12

### Done

- Recapped Mario Kart state (input fix + React-skew fix both live; `mariokart.sjer.red` serves the
  fixed `index-DZhakH1C.js` bundle; no open MK PRs).
- Identified the play session via `stream_active` and pulled emulator/stream/CPU metrics +
  Loki logs for the window; ruled out emulation slowdown, encoder backpressure, CPU throttling,
  and input-path delays.
- Attributed perceived lag to Discord Go-Live viewer-side latency (only video feedback channel).
- Implemented the timestamp overlay (`src/stream/overlay.ts` + tests, wired in `src/index.ts`),
  PR #1128.
- Implemented the full latency-attribution instrumentation per
  `plans/2026-06-12_mk64-latency-instrumentation.md` (same PR): controller RTT reporting
  (`latency-report` request kind + `controller_rtt_ms`), input receive→apply tracker
  (`emulator_input_apply_delay_ms`), StreamObserver wiring (ffmpeg speed ratio/fps/bitrate,
  send frametime ratio, late frames, hw-encode gauge), frame push interval/write histograms,
  per-session summary log, per-seat input-echo HUD (`UTC … 1..4`), and two new Grafana rows on
  the discord-plays dashboard (+ added it to the query-health test corpus).
- All verified: mario-kart workspace tests (43 backend), typecheck, eslint, prettier; homelab
  dashboard tests + cdk8s typecheck.

### Remaining

- Run the post-deploy measurement runbook above after merge + deploy; record the numbers.
- If glass-to-glass is multi-second (expected): step 2 is a WebRTC/WebCodecs feed in the
  controller SPA so players don't depend on the Discord stream for feedback.

### Caveats

- Discord-side latency was inferred by elimination; the overlay + instrumentation exist to
  confirm and quantify it.
- The HUD is always-on for the stream. If it should be toggleable later, follow the
  `STREAM_HARDWARE_ACCELERATION` env-override pattern in `src/index.ts`.
- p95 emulate ~42ms means little headroom; a 60fps bump or busier scenes could push the emulator
  over budget. Watch `emulator_frame_late_ms` / `resync` if changing FPS.
- New panels are empty for pokemon (mario-kart-only instrumentation, by choice).
- Mid-session the homelab node rebooted (all tailnet devices offline at once, public sites
  530/502) — unrelated to this work; uploads/queries resumed after recovery.
