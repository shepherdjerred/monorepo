---
id: streambot-play-history-stats
type: todo
status: in-progress
board: true
verification: agent
disposition: active
source_marker: false
---

# Streambot: record play history and stats

## What

Streambot persists no play history or watch stats today. Add a persistent store
of what was played and expose history/stats.

Current state:

- Only **resume state** is persisted — `packages/streambot/src/state/persistence.ts`
  writes per-channel JSON (`current`, `queue`, `loop`, `volume`,
  `requesterId`); no timestamps, play counts, or completion tracking.
- Metrics are **in-memory Prometheus only** —
  `packages/streambot/src/observability/metrics.ts` /
  `stream-observer.ts` (ffmpeg speed, frametime, hardware fallback, codec info).

## Remaining

- [ ] Define and migrate a durable play-event store with requester, title,
      source kind, start timestamp, duration, and completion outcome; write it
      from the actual playback lifecycle rather than queue insertion.
- [ ] Add repository tests for starts, successful completion, interruption,
      replay, and restart persistence.
- [ ] Expose bounded `/stream history` output plus per-requester and per-title
      counts, with Discord command tests for empty and populated histories.

## Comment Log

### 2026-07-27 — in-progress board audit

- Retained as active. Current persistence still stores resume/queue state only;
  Prometheus playback metrics do not provide durable user-facing history.
