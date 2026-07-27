---
id: streambot-residual-stutter-replay
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/superseded/streambot-stutter-observability-followup.md
---

# Replay the residual Streambot stutter window

PR #1542 added playback-behind, frame-lateness, sync-correction, and queue-depth
signals. The original heavy scene still needs one controlled replay to decide
whether playback tuning remains necessary.

## Remaining

- [ ] Replay the Avengers 1:41–1:56 window and capture the four relevant metric
      series over the same timestamps.
- [ ] If lateness appears, change only `STREAM_READRATE_INITIAL_BURST`, repeat
      the replay, and compare the metric evidence before touching buffer code.
- [ ] Change the demux vPipe high-water mark or investigate per-frame loss only
      if the burst experiment fails; record the final selected configuration
      and a clean replay.

## Comment Log

### 2026-07-27 — split from stutter follow-up

- Created as a bounded production experiment separate from alerting and
  platform observability work.
