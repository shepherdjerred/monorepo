---
id: streambot-stutter-observability-followup
type: todo
status: complete
board: false
---

# Streambot stutter observability — remaining items

Most of the observability follow-up shipped in PR #1542 itself (playback-behind
gauge + 200ms-late counter, pacer sync-correction counters + wait-time counter,
demux→pacer queue-depth gauge, dashboard panels + corrected speed-ratio
semantics + pod-churn panel, `StreambotPlaybackBehindSchedule` alert,
ProducerAhead threshold recalibrated for burst semantics, segment-gauge reset
on stream end, event-exporter `maxEventAgeSeconds` 60→300). All new metrics
were validated live in-cluster: counters flat in steady state, gauge ~0 during
healthy playback, queue depth showing real buffering.

## Split Records

- `streambot-alert-delivery-verification` owns Alertmanager routing proof.
- `streambot-pod-lifecycle-events` owns Kubernetes event retention in Loki.
- `streambot-node-gpu-tenancy-observability` owns optional node-wide DRM usage.
- `streambot-residual-stutter-replay` owns the bounded media replay and tuning
  decision.

## Comment Log

### 2026-07-27 — in-progress board audit

- Archived the mixed parent after preserving the shipped PR #1542 evidence and
  transferring each remaining outcome to an independently verifiable record.
