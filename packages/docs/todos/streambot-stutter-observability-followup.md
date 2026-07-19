---
id: streambot-stutter-observability-followup
status: active
origin: packages/docs/logs/2026-07-18_streambot-f1-stutter-investigation.md
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

## Remaining

1. **Verify alert delivery**: `StreambotEncoderFallingBehind` (speed < 0.95,
   critical) existed before 2026-07-17 and should have fired during the
   Avengers window — the user was not notified. Check the alert's routing /
   contact point before trusting the new `StreambotPlaybackBehindSchedule`.
2. **Pod-lifecycle forensics gap**: the event exporter drops all Normal-type
   events, which includes pod Killing/Scheduled/Started — pod deletions remain
   untraceable in Loki. Needs a keep-route for Pod-kind Normal events (RE2 has
   no negation, so this requires restructuring the drop rules).
3. **Node-level DRM-clients exporter** for whole-GPU tenancy visibility
   (per-pod fdinfo is blind to other tenants; `intel_gpu_top` is broken on
   Raptor Lake — see intel/media-driver#1376).
4. **Residual stutter check with the new gauge**: after PR #1542 deploys,
   replay Avengers @ 1:41–1:56 and watch `streambot_playback_behind_seconds` /
   `streambot_frames_behind_schedule_total` through the heaviest tail. If
   lateness still materializes: raise `STREAM_READRATE_INITIAL_BURST`
   (env-only), then consider enlarging the demuxer vPipe
   `writableHighWaterMark` (128), then use the sync-correction counters to
   hunt any remaining per-frame loss.
