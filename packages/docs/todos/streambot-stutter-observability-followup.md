---
id: streambot-stutter-observability-followup
status: active
origin: packages/docs/logs/2026-07-18_streambot-f1-stutter-investigation.md
---

# Streambot pacing observability + residual stutter follow-up

Follow-up to PR #1542 (pre-roll cushion + pacer schedule-leak fix). The fix
took heavy-scene production from 0.942x mean (deficit growing ~3.5 s/min,
unbounded) to ~0.99x with the deficit repeatedly recovering to zero — but the
heaviest ~90 s stretch can still transiently exceed the ~6.7 s cushion
(receiver pre-roll + vPipe), and today's metrics cannot say whether that is
viewer-visible.

## Work items (ranked by debugging time they would have saved)

1. **`streambot_playback_behind_seconds` gauge + frames-late counter** in the
   pacer (`BaseMediaStream` knows pts-vs-wall-schedule at every frame). This
   directly measures the user-facing symptom; every conclusion in the
   investigation had to be inferred from production-side proxies.
2. **Pacer sync-correction counters**: `pacer_sync_events_total{direction}`
   and `pacer_schedule_reset_lost_ms_total`. The root cause lived in an
   uninstrumented code path that computes and discards every relevant number.
3. **Demux→pacer queue-depth gauge** (vPipe occupancy) — separates
   producer-starved from consumer-paced dips in one panel.
4. **Dashboard corrections**: speed-ratio panel description (1.0 = ceiling
   since `-readrate 1`; >1.0 = catch-up, not headroom) and an alert on
   `avg_over_time(streambot_ffmpeg_speed_ratio[5m]) < 0.97 and
streambot_stream_active == 1`.
5. **Gauge lifecycle**: reset ffmpeg-derived gauges on stream end (frozen-gauge
   artifact repro'd 3×; it manufactured a false 1.4x "healthy baseline"), or
   mask stale samples via `streambot_ffmpeg_progress_age_seconds`.
6. **Homelab**: raise kubernetes-event-exporter `maxEventAgeSeconds`
   (pod-delete causes were discarded); pod-churn panel via
   `kube_pod_start_time` changes; eventually a node-level DRM-clients exporter
   for whole-GPU tenancy (per-pod fdinfo is blind to other tenants and
   `intel_gpu_top` is broken on Raptor Lake).

## Residual investigation (needs item 1 first)

With `playback_behind_seconds` in place, replay Avengers @ 1:41:00–1:56:00 and
check whether the heaviest-tail transient deficit (14.4 s observed at 20 s
sampling) actually starves the sender. If yes: first mitigation is raising
`STREAM_READRATE_INITIAL_BURST` (env-only, no code); second is enlarging the
demuxer vPipe `writableHighWaterMark` (128 packets today); third is hunting
the remaining per-frame loss with the new counters.
