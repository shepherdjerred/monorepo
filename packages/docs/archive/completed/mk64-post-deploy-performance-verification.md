---
id: mk64-post-deploy-performance-verification
type: todo
status: complete
board: false
origin: packages/docs/logs/2026-07-28_mk64-runtime-performance-followup.md
source_marker: false
---

# Verify MK64 startup and realtime streaming after deployment

PR #1779 repairs the Emscripten host contract and restores the emulator's 60 Hz
VI cadence while preserving 30 fps video output. The change was verified with
an immutable image built from the PR head and temporarily deployed by digest.

## Remaining

- [x] Confirm the deployed Mario Kart image contains PR #1779.
- [x] Start a live `/play` session and confirm the emulator initializes without
      an Emscripten export error.
- [x] During a sustained session, confirm ffmpeg remains near 30 fps and `1.0x`
      realtime with negligible frame drops.
- [x] Confirm game audio remains synchronized with video.

## Comment Log

- 2026-07-28 — Split from the completed implementation log because deployment
  and live Discord verification are privileged deterministic operator work,
  not user acceptance testing.
- 2026-07-28 — Operator authorization granted. Built PR head `0c8cc45db` with
  the production Bake target, published immutable digest `sha256:2a75f7c82600`,
  paused Argo CD auto-sync for the test window, and verified that exact digest
  was Ready in Kubernetes.
- 2026-07-28 — Live `/play` succeeded without `_malloc`: the emulator booted,
  Go-Live entered `streaming`, and VAAPI ffmpeg started. A 30-second four-seat
  load test measured 29.03 emulator fps, 30.04 ffmpeg fps, `0.9997x` mean
  ffmpeg speed, zero resyncs, zero sink backlog, and zero late video/audio
  sends. The audio and video clocks therefore remained in realtime lockstep.
- 2026-07-28 — Stopped the test session and restored the exact prior image plus
  Argo CD automated sync. The Application returned to `Synced` / `Healthy`.
  The independent `/stop` Worker reset-order error is tracked in
  `mk64-worker-session-stop-reset-order`.
