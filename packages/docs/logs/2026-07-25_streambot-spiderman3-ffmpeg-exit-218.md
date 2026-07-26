---
id: 2026-07-25-streambot-spiderman3-ffmpeg-exit-218
type: log
status: complete
board: false
---

# Streambot: Spider-Man 3 stream dies 1s in (ffmpeg exit 218, VAAPI tonemap reinit)

## Symptom

User queued `Spider-Man 3 (2007) Remux-2160p Proper.mkv` at 2026-07-26 03:55 UTC.
Streambot joined voice, probed the file (HEVC Main10, HDR bt2020/smpte2084,
3840x2160, TrueHD/AC-3), started ffmpeg, and ~1.1s later the stream silently
ended and the machine transitioned to `waiting`. Pod: `media/media-streambot-55d856f889-gptpl`.

## Root cause (reproduced)

Two stacked issues:

1. **ffmpeg 7.1.5 VAAPI filter-graph reinit bug.** The GPU HDR pipeline
   (`scale_vaapi=w=1920:h=1080:format=p010,tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709`,
   built in `packages/discord-video-stream/src/media/videoGraph.ts:131`)
   decodes ~1.7s fine, then the HEVC decoder triggers a mid-stream
   "hwaccel changed" reconfig. On reinit, format negotiation fails:

   ```
   [vf#0:0] Reconfiguring filter graph because hwaccel changed
   Impossible to convert between the formats supported by the filter
   'Parsed_tonemap_vaapi_1' and the filter 'auto_scale_0'
   [vf#0:0] Error reinitializing filters!  (-38, Function not implemented)
   Conversion failed!  → exit 218
   ```

   `auto_scale_0` is a software scale; it has no path into the hardware-only
   `tonemap_vaapi` input, so renegotiation is impossible. Reproduced by running
   the exact logged ffmpeg command via `kubectl exec` in the pod.
   - **Only the first ~2s of this file triggers it**: the identical command with
     `-ss 10` runs clean for the full 20s test window.
   - `-reinit_filter 0` does **not** help — same failure.

2. **HW→SW fallback never fires on mid-stream death.** The retry safety net
   (see `packages/docs/archive/completed/2026-06-12_streambot-gpu-subs-hdr.md`)
   covers graph _init_ failures. Here ffmpeg dies ~1s in: it closes the nut
   pipe, the demuxer reads EOF (`demux:frame:common: Reached end of stream.
Stopping`), treats it as a natural stream end, and the machine goes to
   `waiting`. The `seekablePlayer` logs `ffmpeg failed` (exit 218) as ERROR,
   but nothing distinguishes "ffmpeg crashed mid-stream" from "source ended",
   so no retry happens.

## Evidence

- Failure window logs: `kubectl logs -n media media-streambot-55d856f889-gptpl --since-time=2026-07-26T03:50:00Z`
- Repro command (fails at ~2s, exit 218): the logged `ffmpeg command` from
  `streamer:metrics` at 03:55:34, run in-pod with `-t 30` and stdout to
  `/dev/null`.
- ffmpeg in image: `7.1.5-0+deb13u1` (Debian trixie), iHD on `/dev/dri/renderD128`.

## Fix options

- **Streambot (correct fix):** treat mid-stream ffmpeg exit (non-zero code, or
  output far short of probed duration) as a failure, not EOF, and route through
  the existing HW→SW retry at the last known position. The zimg/Hable software
  tonemap chain already exists for this.
- **Upstream:** report to ffmpeg trac — VAAPI tonemap graph reinit after
  "hwaccel changed" on HEVC (7.1.x regression candidate).

## Session Log — 2026-07-25

### Done

- Pulled k8s logs for `media-streambot-55d856f889-gptpl`; located the failed
  Spider-Man 3 session (03:55 UTC).
- Reproduced the failure in-pod with the exact ffmpeg command; captured the
  real error (hidden in the app log, which only keeps ffmpeg's last line).
- Tested `-ss 10` (works) and `-reinit_filter 0` (fails identically).

### Remaining

- Implement mid-stream-crash detection + HW→SW retry in streambot
  (`packages/streambot` / `packages/discord-video-stream`).
- Optionally file upstream ffmpeg bug.

### Caveats

- The app log only retains ffmpeg's final stderr line; the actual negotiation
  error lines are only visible when running ffmpeg manually. Worth logging more
  of ffmpeg's stderr tail on non-zero exit.
- Other 2160p HDR remuxes may hit the same reinit depending on their HEVC
  headers; this is file-specific, not a general HDR outage.

## Comment Log

- 2026-07-25 (later session): User hit this again live (same pod
  `media/media-streambot-55d856f889-gptpl`, same Spider-Man 3 play at
  03:55 UTC — this is the occurrence diagnosed above; no new failure since).
  Pod is healthy otherwise; the fix in "Remaining" (mid-stream-crash
  detection + HW→SW retry) is still unimplemented.
- 2026-07-25 (same session, Phase 0 experiments in-pod): plain HW retry
  at `-ss 1`/`-ss 2` still exits 218 (bad region extends past the crash
  position; only `-ss 10` known-good), `hwupload` head with GPU output
  frames also 218. **HW decode → system frames → `hwupload` → GPU
  scale/tonemap/encode plays clean (exit 0)** at 1.34–1.48x realtime vs
  6.1x for pure HW. Fix design (see
  `packages/docs/plans/2026-07-25_streambot-playback-outcome-model.md`):
  truthful crash detection in the fork + machine-level bounded retry
  ladder hw → hw → hw-upload → sw at last position, wedge timeouts,
  stall detection, and Discord announcements.
