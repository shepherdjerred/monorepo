---
id: plan-2026-07-03-streambot-voice-drop-robustness
type: reference
status: complete
board: false
---

# Streambot: robust handling of Discord voice-session drops

## Context

On 2026-07-02/03, three movie streams died mid-playback with zero errors anywhere. Diagnosis
(the original investigation):

1. Discord ends the userbot's voice session (close code never logged).
2. dvs fork `BaseMediaConnection.ts:160-174`: non-resumable ws closes silently set `_closed` and
   close WebRTC — `e.code` discarded, no log/event. Verified bonus bug: local `stop()` closes the
   ws with code 1000, which the close handler treats as resumable → **phantom resume socket after
   every normal stop** (handler never checks `_closed`).
3. Secondary hole: after WebRTC close, `sendVideoFrame/sendAudioFrame` are silent no-ops
   (`WebRtcWrapper.ts:113-125`) — pipeline would run to ffmpeg EOF streaming to nobody.
4. What stops playback is the _main_ gateway: command-bot voiceStateUpdate → dispatches
   `STREAMER_VOICE_DETACHED` (`command-bot.ts:356-362`, unlogged).
5. Machine treats it as permanent stop (`playback-machine.ts:276-286`) → teardown **deletes the
   resume state file** (`session-manager.ts:406→438→469`) — why "resume didn't work."
6. Reason lands in `context.lastError` but is dropped from StatusSnapshot (`session-manager.ts:386-398`).

## Requirements (user-confirmed)

| Scenario                                | Behavior                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Transient drop (non-4014 / unknown)     | Auto-rejoin + resume at last position, bounded retries, announce; preserved state file as fallback |
| Deliberate disconnect (fresh 4014 kick) | Stay down, delete state (current behavior) — but log + announce                                    |
| All                                     | Close codes logged; detach logged; stop reasons announced; metrics + alerts                        |

## Architecture

**Recovery vehicle = existing boot-resume machinery, orchestrated by SessionManager.**
No playback-machine changes. On voice loss: snapshot live position → teardown with
`preserveStateOnTeardown` → delayed `resumeOne()` (extracted from `resumeAll`), which re-acquires a
userbot and respawns with `initialSeekSeconds` — reusing `buildResumeInput` crash-loop guards
(`MAX_RESUME_ATTEMPTS=3`, `RESUME_CONFIRM_MS=30s`) and the "🔄 resuming from <T>" announcement.

Why not a `reconnecting` machine state: position isn't in machine context; `joining.onError →
failed → idle + clearQueue` would need invasive rework; and rejoin requires full
`leaveVoice` anyway (`Streamer.ts:189-197` is the only place gateway listeners are removed —
verified). The teardown→fresh-spawn path is the battle-tested boot path.

**Classification flow:**

```
dvs ws close → log code + emit typed "close" {code, canResume, deliberate: code===4014}
  → StreambotStreamer records lastVoiceClose {code, deliberate, atMs}, fires listener  (trigger 1 — also covers the silent-to-EOF hole)
command-bot voiceStateUpdate (streamer→null) → log + sessions.notifyStreamerDetached()  (trigger 2)
  → SessionManager single-flight recovery (pendingRecoveries keyed guild:channel):
     classify (deliberate ⇔ 4014 within 15s freshness; no info ⇒ transient)
     → saveSnapshot BEFORE dispatch (position is wall-clock-live) → dispatch detach
       (aborts runStream → player.stop → ffmpeg killed; no zombie pipeline)
     → deliberate: announce kick, delete state, done
     → transient: announce "🔌 dropped (code N) — reconnecting…", schedule resumeOne after
       delaySeconds; RE-classify at fire time (catches late-arriving 4014); bounded by
       reconnect.maxAttempts; exhausted → announce + keep state file (boot/manual fallback)
```

Non-goals: wiring `PRODUCER_FAILED`; making WebRtcWrapper sends throw (close event is the
authoritative signal; not worth fork divergence); auto-recovery for `VOICE_TARGET_MOVED`;
adopting the event in `discord-plays-*`.

## Workstreams

| #   | Area                   | Files                                                                                                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | dvs close surfacing    | `discord-video-stream/src/client/voice/BaseMediaConnection.ts`, `README.md`                                          | Log every ws close (`this._logger`, "conn" ns); emit typed `close` event on non-resumable branch; guard close handler against local `stop()` (reuse `_closed`, set before `ws.close()` at :117-121, or a `_stopRequested` flag — fixes phantom resume); extract `protected createWebSocket()` seam (:147) for tests; document divergence in README                                                                                                                                                                                                                      |
| B   | Streamer plumbing      | `streambot/src/streamer/streamer.ts`                                                                                 | `VoiceCloseInfo` + Zod schema (EventEmitter boundary, no assertions); extend `StreamerLike` with `lastVoiceCloseInfo()` + `setVoiceCloseListener()`; subscribe on VoiceConnection after `joinVoice` (:209); detach listener in `safeStop` (:189) so local stops never fire it                                                                                                                                                                                                                                                                                           |
| C   | Recovery orchestration | `streambot/src/session/session-manager.ts`, new `session/voice-recovery.ts`                                          | Pure `classifyVoiceLoss(close, nowMs, freshnessMs=15s)` + announcement builders; `Session.preserveStateOnTeardown`; `pendingRecoveries` map; public `notifyStreamerDetached()`; `handleVoiceConnectionLost()` entry point wired via `setVoiceCloseListener` in `spawn` (:330); `teardown` (:438) skips `deleteStateAfterFlush` when preserving; extract `resumeOne()` from `resumeAll` body (:249-311); attempt counters reset when `resumeConfirmed` flips (:521-527); cancel timers in `destroyAll` (:315); guard: manual `/stream play` during window → timer no-ops |
| D   | Command-bot            | `streambot/src/discord/command-bot.ts`                                                                               | :356-362 → `log.warn` + `sessions.notifyStreamerDetached()`; log the `session-move.ts:54` dispatch too; alone-timer needs no change (cleared at :357; STOP on missing session is a no-op)                                                                                                                                                                                                                                                                                                                                                                               |
| E   | Stop-reason surfacing  | `streambot/src/discord/status-reporter.ts`, `session-manager.ts:386-398`                                             | Add `lastError`/`lastErrorKind` to `StatusSnapshot`; announce `⏹️ Stream stopped: {reason}` once on active→idle-with-error edge (deduped)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F   | Config                 | `streambot/src/config/schema.ts` (:82-89 pattern), `config/index.ts`                                                 | `reconnect: { enabled (STREAMER_RECONNECT_ENABLED, default true), delaySeconds (…_DELAY_SECONDS, 5), maxAttempts (…_MAX_ATTEMPTS, 3) }`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| G   | Metrics + alerts       | `streambot/src/observability/metrics.ts`, `homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/streambot.ts` | `streambot_voice_disconnects_total{deliberate}`; `streambot_voice_reconnects_total{outcome=success\|failed\|exhausted\|skipped}`; alerts: >3 disconnects/1h warning, any `exhausted`/15m critical                                                                                                                                                                                                                                                                                                                                                                       |

## Tests

- **dvs** `test/base-media-connection.test.ts` (new; via `createWebSocket` fake): 4015 → internal
  resume, no emit; 4006 → emit `{deliberate:false}`; 4014 → `{deliberate:true}`; `stop()` + 1000 →
  no emit **and no resume socket** (regression for phantom-resume fix).
- **voice-recovery.test.ts**: fresh 4014 → deliberate; stale 4014 (>15s) / null → transient; messages.
- **session-manager.test.ts** (existing fakeStreamer/fakePool/temp-dir pattern; fake gains
  `triggerVoiceClose`): transient → file survives teardown, respawn with `initialSeekSeconds`,
  resume announcement; deliberate → file deleted, no respawn; retries → exhausted announcement +
  file kept; manual re-play during window → skip; `enabled=false` → stay-down + announcements only.
- **status-reporter.test.ts**: stop-reason announcement, deduped. **config.test.ts**: new envs.
- Existing `playback-machine.test.ts` untouched (machine unchanged).

## Verification

1. `bun run typecheck && bun run test` in `discord-video-stream`, `streambot`; `bunx eslint . --fix` both.
2. `packages/streambot/e2e/local.ts` still passes.
3. Live (dev creds): start a stream, right-click-disconnect the userbot in Discord → expect kick
   announcement + stay down + state file deleted. Simulate transient (kill voice ws / brief pod
   network cut) → expect "🔌 … reconnecting" + auto-resume near same timecode + `outcome="success"` metric.
4. Prod after deploy: Loki `{app="media-streambot"} |= "voice gateway websocket closed"`; Grafana
   panels on both counters; next real drop should leave a full breadcrumb trail.

## Rollout

- One worktree, **single PR** (dvs fork + streambot + homelab rules). Mirror this plan to
  `packages/docs/plans/2026-07-03_streambot-voice-drop-robustness.md` before implementing.
- No env changes required (defaults on). Kill switch: `STREAMER_RECONNECT_ENABLED=false` keeps all
  logging/announcements but restores stay-down behavior.
- State-file format unchanged (v2). dvs consumed as workspace source — no publish step.

## Risks

- **Kick seen as transient** (gateway event beats 4014): re-classify at timer fire; worst case one
  rejoin after a kick, second kick lands fresh 4014. Bounded by maxAttempts.
- **Channel moves also close ws with 4014**: moves stay on the existing `VOICE_TARGET_MOVED`/
  `session-move` path (not auto-recovered); new logging will reveal actual close behavior for a follow-up.
- **Runaway loops**: triple-bounded — `reconnect.maxAttempts` per incident, `MAX_RESUME_ATTEMPTS`
  per item, `resumeMaxAgeSeconds` on the file.
- **Pool race** (userbot re-acquired by another guild before timer): treated as failed attempt,
  retries/exhausts like boot's "no userbot free" branch (session-manager.ts:272-289).
- **Alone-timer gap** after auto-resume (occupancy re-checked only on next voice event) —
  pre-existing boot-resume behavior, documented not fixed.
