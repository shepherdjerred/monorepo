# mariokart.sjer.red — "massive input lag" during multiplayer session investigated

## Status

Complete (diagnosis + glass-to-glass measurement overlay shipped)

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

## Session Log — 2026-06-12

### Done

- Recapped Mario Kart state (input fix + React-skew fix both live; `mariokart.sjer.red` serves the
  fixed `index-DZhakH1C.js` bundle; no open MK PRs).
- Identified the play session via `stream_active` and pulled emulator/stream/CPU metrics +
  Loki logs for the window; ruled out emulation slowdown, encoder backpressure, CPU throttling,
  and input-path delays.
- Attributed perceived lag to Discord Go-Live viewer-side latency (only video feedback channel).
- Implemented the timestamp overlay (`src/stream/overlay.ts` + tests, wired in `src/index.ts`,
  eslint allowDefaultProject entry). 20/20 backend tests, typecheck and lint clean.

### Remaining

- After deploy: play/watch a session, read latency off the stream vs `date -u`, record the number.
- If multi-second (expected): decide on step 2 (WebRTC/WebCodecs feed in the controller SPA).

### Caveats

- Discord-side latency was inferred by elimination; the overlay exists to confirm it.
- The overlay is always-on for the stream. If it should be toggleable later, follow the
  `STREAM_HARDWARE_ACCELERATION` env-override pattern in `src/index.ts`.
- p95 emulate ~42ms means little headroom; a 60fps bump or busier scenes could push the emulator
  over budget. Watch `emulator_frame_late_ms` / `resync` if changing FPS.
