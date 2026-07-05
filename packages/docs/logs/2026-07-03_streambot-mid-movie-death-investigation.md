# Streambot mid-movie deaths + resume failure — investigation

## Status

Complete (investigation only; no code changes)

## Symptom

User reports movies "randomly stopped/died" mid-playback on 2026-07-02 and 2026-07-03, and the built-in resume functionality didn't recover the position.

## Incidents (times PT / UTC)

| #   | Movie                              | Started                    | Died              | Played | Movie length |
| --- | ---------------------------------- | -------------------------- | ----------------- | ------ | ------------ |
| 1   | Ep. I Phantom Menace               | 07-02 18:45 (07-03 01:45Z) | 18:57 (01:57:00Z) | 11m51s | 2h16m        |
| 2   | Ep. III Revenge of the Sith        | 07-03 13:17 (20:17Z)       | 14:25 (21:25:44Z) | 67m47s | 2h20m        |
| 3   | Sith (manual re-play + seek 3717s) | 07-03 14:35 (21:35Z)       | 14:46 (21:46:35Z) | 10m48s | —            |

## Evidence

- All three deaths share the identical Loki signature, same millisecond, **no error, no reason**:
  `left voice` → `stream ended` → `session ended` (+ dvs `demux: Reached end of stream. Stopping` after).
- Log **ordering** (`left voice` before `stream ended`) proves a _stop-driven_ teardown, not a natural
  end: natural end logs `stream ended` (streamer.ts:380) before the machine calls `leaveVoice`.
- Prometheus (`streambot_ffmpeg_out_time_seconds_total`, `streambot_ffmpeg_progress_age_seconds`,
  `streambot_ffmpeg_speed_ratio`): ffmpeg was healthy to the final scrape — out_time advanced 1:1
  with wall clock, progress age pinned at 0, ~2× encode headroom. Died at 711s of 8171s (PM) and
  4065s of 8408s (Sith). No stall, no slowdown.
- `streambot_stream_segments_total` incremented with `outcome="ended"` (clean) each time.
- Pod did **not** restart at death times (restarts at 07-03 02:44Z and 19:50Z are unrelated deploys).
- The alone-timer stop path logs `"voice channel empty for grace period — stopping"` — absent, so it
  wasn't the empty-channel auto-leave. No `/stream stop` either.
- Bugsink `streambot` project: zero issues.
- Other Discord bots (birmel, etc.) show no gateway/disconnect logs in the same windows — not a
  cluster-wide network event (or at least not one they log).

## Root cause chain

1. Discord ends the userbot's **voice session** (cause unknown — close code is never logged).
2. `dvs BaseMediaConnection` ws `close` handler (`packages/discord-video-stream/src/client/voice/BaseMediaConnection.ts:160-174`):
   non-resumable close codes (≥4000 except 4015, e.g. 4006 "session invalid" / 4014 "disconnected")
   silently set `_closed` and close WebRTC. **No log, no reconnect, no event.**
3. Discord gateway broadcasts the streamer leaving voice → command-bot `voiceStateUpdate`
   (`packages/streambot/src/discord/command-bot.ts:356-363`) dispatches
   `STREAMER_VOICE_DETACHED` ("streamer disconnected or was kicked from voice") — **not logged**.
4. Playback machine (`playback-machine.ts:276`) → `leaving` → `idle`, `clearQueue` + `recordExternalStop`.
   `lastError` holds the reason but the reporter snapshot (`session-manager.ts:380-397`) doesn't
   include it → **reason surfaces nowhere** (not Discord, not logs, not Sentry).
5. `session-manager.teardown()` treats it like a natural end and **deletes the resume state file**
   (`deleteStateAfterFlush`). Resume checkpoints only survive _process_ crashes — an external voice
   drop erases them by design. Hence "resume didn't work"; the `-ss 3717` on re-play was a manual seek.

## Gaps / candidate fixes (not implemented)

1. **Log voice ws close codes** in dvs `BaseMediaConnection` (code, wasClean, resumability decision) —
   without this the _why_ of the Discord-side drop is unknowable.
2. Log `STREAMER_VOICE_DETACHED` dispatch in command-bot with guild/channel.
3. Surface `lastError` / external-stop reason in the reporter snapshot → announce to text channel.
4. Preserve resume state on external stops (only delete on true natural end / explicit stop), or
   better: auto-rejoin + resume at last position on `STREAMER_VOICE_DETACHED`.
5. Unrelated but observed: `announce failed: Missing Permissions` in channel `774860911927099392`;
   `client destroy failed: null is not an object (readyState)` warn on every shutdown.

## Artifacts

- Flattened 24h Loki log + Prometheus query dumps in session scratchpad (`streambot-flat.log`,
  `prom-{pm,sith,resume}.json`).

## Session Log — 2026-07-03

### Done

- Pulled 24h of `{app="media-streambot"}` Loki logs (388 lines, complete) and all streambot
  Prometheus metrics around the three death timestamps.
- Traced the silent-teardown code path end-to-end: dvs ws close → voiceStateUpdate →
  `STREAMER_VOICE_DETACHED` → machine `leaving` → teardown → resume-state deletion.
- Ruled out: ffmpeg crash/stall, OOM/pod restart, alone-timer, /stop, Sentry-visible errors,
  cluster-wide Discord issues.

### Remaining

- Decide on and implement fixes (observability first: close-code + detach logging, reason
  announcement; then behavior: auto-rejoin/resume, resume-state preservation).
- Actual Discord-side cause of the voice drops is unknown until close codes are logged.

### Caveats

- `STREAMER_VOICE_DETACHED` is the best-fit explanation (only silent stop path matching all
  evidence), but since nothing on that path logs, it's inferred, not directly observed. The
  close-code logging fix would confirm it on the next occurrence.
- `toolkit gf log-label-values` / `log-labels` hit 404s (Grafana proxy API route) — used
  `/api/datasources/uid/loki/resources/...` instead.
