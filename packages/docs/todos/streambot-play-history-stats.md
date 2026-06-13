---
id: streambot-play-history-stats
status: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
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

## Done when

- A persistent store records timestamped play events:
  `{ userId/requesterId, title, sourceKind (file|url|search), playedAt,
durationSeconds, completed }`.
- History/stats are queryable (e.g. a `/stream history` command, per-user and
  per-title play counts).
