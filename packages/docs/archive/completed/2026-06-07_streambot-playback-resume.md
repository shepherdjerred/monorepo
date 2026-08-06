---
id: reference-completed-2026-06-07-streambot-playback-resume
type: reference
status: complete
board: false
---

# Streambot: Full Playback Resume Across Restarts

## Context

Streambot streams movies to a Discord voice channel. Before this change, **any restart killed the
viewing experience**: deploys use `strategy: Recreate` (the old pod is SIGTERM'd and killed before the
new one starts), and all playback state lived only in the in-memory XState machine (the one writable
mount `/data/videos` is an `emptyDir` wiped on restart). A version bump mid-movie dropped the stream
and lost the queue.

This adds **position-level resume across restarts** (deploy, crash, OOM, node reboot). On boot the bot
rejoins voice, re-resolves the in-progress movie, starts it at roughly the saved offset (the fork's
`startTime`/`-ss`), restores the queue + loop + volume, and posts a back-online message. A restart
becomes a ~30–60s blip instead of a hard stop. `Recreate` is kept so the RWO state PVC detaches before
the new pod attaches.

## What shipped

| Area              | File(s)                                                         | Change                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Position tracking | `streambot/src/streamer/streamer.ts`, `streamer/elapsed.ts`     | wall-clock elapsed (`segmentStartOffsetSeconds` + injectable `now()`), public `getPosition()`, pure `computeElapsed`; HW→SW retry now resumes at true elapsed; injectable player factory for tests |
| Resume seek       | `streambot/src/machine/types.ts`, `machine/playback-machine.ts` | `RunStreamInput.seekSeconds`; `PlaybackContext.resumeSeekSeconds` (one-shot, `consumeSeek` on `streaming` exit); `PlaybackInput.initial{Queue,Loop,Volume,SeekSeconds}`                            |
| Persistence       | `streambot/src/state/persistence.ts`                            | Zod `PersistedStateSchema` v1; `loadState` (fail-soft, version + staleness guards); `saveState` (atomic tmp+rename)                                                                                |
| Resume logic      | `streambot/src/state/resume.ts`                                 | pure `buildSnapshot`, `buildResumeInput` (in-progress item → queue[0], guild-mismatch + crash-loop guards), `buildResumeAnnouncement`, `resumeKeyFor`                                              |
| Config            | `streambot/src/config/{schema,index}.ts`                        | `state.dir` (`STATE_DIR`, default `/state`) + `state.resumeMaxAgeSeconds` (`RESUME_MAX_AGE_SECONDS`, default 6h)                                                                                   |
| Wiring            | `streambot/src/index.ts`                                        | restore on boot → actor input; start machine after login; back-online announce; ~10s checkpoint; final flush on SIGTERM before stop                                                                |
| Deployment        | `homelab/src/cdk8s/src/resources/streambot.ts`                  | 1Gi `ZfsNvmeVolume` (`streambot-state-pvc`) mounted writable at `/state`; `STATE_DIR=/state`; `Recreate` kept                                                                                      |

### Key correctness notes

- The fork's `Player.position` is the **segment start offset / last seek target**, not live elapsed
  time. Resume tracks elapsed itself via wall-clock in the streamer.
- **Not persisted:** the resolved `ffmpegInput` (yt-dlp URLs expire) — the original `Source` is stored
  and re-resolved on boot, then sought. Also not persisted: voice handle, transient errors, moderation
  nonces, tokens.
- **Crash-loop guard:** if resuming `current` keeps crashing the pod, after `MAX_RESUME_ATTEMPTS` (3)
  the item is dropped and the queue resumes instead. Counter resets once the resume runs healthily
  (`RESUME_CONFIRM_MS`).
- `canonicalUrl` pinning for `search` re-resolution was scoped out (would need yt-dlp to surface
  `webpage_url`); search resume re-runs the query (documented edge — usually the same video).

## Tests (automated)

- **Unit:** `elapsed.test.ts`, `persistence.test.ts` (round-trip, atomic, corrupt/missing fail-soft,
  strictObject, version + staleness boundaries), `resume.test.ts` (snapshot, resume-input incl.
  crash-loop + guild-mismatch + queue-only, announcement, round-trip), `config.test.ts` (state defaults
  - env), machine resume cases in `playback-machine.test.ts` (seek on first play, 0 on loop/skip).
- **Integration:** `streamer-position.test.ts` (fake player factory + injected clock: getPosition,
  `-ss` reaches ffmpeg, HW→SW retry resumes at elapsed); `resume-loop.test.ts` (real machine + real
  persistence + fake streamer: stream → checkpoint → restart → resume at saved position, queue/loop/
  volume restored).
- **Manifests:** `homelab/.../streambot.test.ts` — `/state` writable mount, `STATE_DIR`, RWO PVC,
  `Recreate` regression guard.
- **e2e (`e-2-e-streambot`, CI):** `e2e/run.ts` resume phase — stream a 30s clip, assert
  `getPosition() > 3`, persist, tear down, boot a fresh session from disk, assert it resumes within
  tolerance and keeps advancing.
