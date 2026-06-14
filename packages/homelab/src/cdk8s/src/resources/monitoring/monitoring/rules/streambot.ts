import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

/**
 * Streambot pipeline-health alerts. Most of these were authored after the 2026-06-14 stutter
 * incident, where ffmpeg produced at 3.4× realtime for ~30 fps Discord consumers — the NUT-pipe
 * consumer accumulated buffers at ~25 MB/s, the JSC heap hit 6.4 GB, and major GC pauses (300 ms)
 * showed up as Discord viewer-visible 1 s freezes via the receiver's NetEQ jitter buffer.
 *
 * The mechanism gives four orthogonal signals to alert on:
 *   1. encoder forward progress (out_time) — catches stderr deadlocks the `speed` field can't
 *   2. producer/consumer rate mismatch (speed > 1.10) — catches the root cause directly
 *   3. JS-side queue accumulation (heap growth, external/heap ratio) — catches the symptom
 *   4. send-path lateness (drop_frames, frametime ratio) — catches what the viewer actually sees
 */
export function getStreambotRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "streambot.rules",
      interval: "30s",
      rules: [
        // --- encoder pipeline health -------------------------------------------------
        {
          alert: "StreambotEncoderStalled",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(streambot_ffmpeg_out_time_seconds_total[1m]) < 0.5 and streambot_stream_active == 1",
          ),
          for: "30s",
          labels: { severity: "critical", category: "streaming" },
          annotations: {
            summary: "Streambot encoder is no longer making forward progress",
            description: escapePrometheusTemplate(
              "ffmpeg's media-time is advancing at < 0.5× realtime for at least 30 s while a stream is active. The encoder has stalled — either subprocess died, stderr/stdout deadlocked, or input demux blocked. Canonical detector per the ffmpeg-user mailing list: trust out_time velocity, never `speed=` alone.",
            ),
          },
        },
        {
          alert: "StreambotEncoderProducerAhead",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "avg_over_time(streambot_ffmpeg_speed_ratio[1m]) > 1.10 and streambot_stream_active == 1",
          ),
          for: "1m",
          labels: { severity: "warning", category: "streaming" },
          annotations: {
            summary:
              "ffmpeg producing > 1.10× realtime — JS-side buffer queue is growing",
            description: escapePrometheusTemplate(
              "The root cause of the 2026-06-14 stutter incident: ffmpeg's `-readrate` cap is missing or higher than the realtime send loop can consume. NUT-pipe consumer buffers accumulate, V8/JSC major GC pauses ≥ 200 ms, Discord viewers see ~1 s freezes. Set STREAM_READRATE=1.0 (the default) on streambot's deployment if this fires.",
            ),
          },
        },
        {
          alert: "StreambotEncoderFallingBehind",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "avg_over_time(streambot_ffmpeg_speed_ratio[1m]) < 0.95 and streambot_stream_active == 1",
          ),
          for: "30s",
          labels: { severity: "critical", category: "streaming" },
          annotations: {
            summary:
              "ffmpeg falling behind realtime — viewers will stall once buffer drains",
            description: escapePrometheusTemplate(
              "The Mux stream-drift concept applied locally: producer < consumer means startup buffer is being drained without replacement. Common causes: decoder bound on CPU, GPU contention with another tenant on /dev/dri/renderD128, or input demux source slowdown.",
            ),
          },
        },
        {
          alert: "StreambotProgressStalled",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "streambot_ffmpeg_progress_age_seconds > 5 and streambot_stream_active == 1",
          ),
          for: "30s",
          labels: { severity: "critical", category: "streaming" },
          annotations: {
            summary:
              "No ffmpeg progress event in > 5 s — subprocess deadlocked or died",
            description: escapePrometheusTemplate(
              "fluent-ffmpeg's `progress` events have stopped firing. Possible causes (in order of likelihood): stderr buffer un-drained → child blocked on write (ffmpeg-python#195 deadlock), encoder context crash, segfault. Investigate `kubectl logs` and `kubectl exec -- ps` immediately.",
            ),
          },
        },
        // --- viewer-side symptoms ----------------------------------------------------
        {
          alert: "StreambotLateFramesElevated",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'rate(streambot_send_late_frames_total{kind="video"}[1m]) > 0.5',
          ),
          for: "1m",
          labels: { severity: "critical", category: "streaming" },
          annotations: {
            summary: "Viewers seeing late video frames at > 0.5/sec",
            description: escapePrometheusTemplate(
              "The send path is missing the frame budget on > 0.5 frames per second sustained over a minute. With a 30 fps target that's > 1.5% of frames. Cross-reference event-loop p99 (GC pauses?) and ffmpeg_speed_ratio (producer mismatch?).",
            ),
          },
        },
        // --- JS heap / queue health --------------------------------------------------
        {
          alert: "StreambotHeapGrowing",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "deriv(streambot_nodejs_heap_size_used_bytes[5m]) > (10 * 1024 * 1024) / 60",
          ),
          for: "5m",
          labels: { severity: "warning", category: "streaming" },
          annotations: {
            summary: "Streambot JS heap growing > 10 MiB/min sustained",
            description: escapePrometheusTemplate(
              "Unbounded-queue signature: the JS heap is gaining > 10 MiB per minute over 5 m. Pair with `streambot_nodejs_external_memory_bytes / streambot_nodejs_heap_size_used_bytes > 0.5` for the Buffer-heavy queue case (vs a real leak). When both fire, the consumer (RTP send) cannot drain the producer (ffmpeg pipe).",
            ),
          },
        },
        {
          alert: "StreambotExternalBufferHeavy",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "streambot_nodejs_external_memory_bytes / streambot_nodejs_heap_size_used_bytes > 0.5",
          ),
          for: "5m",
          labels: { severity: "warning", category: "streaming" },
          annotations: {
            summary: "external / heapUsed > 0.5 — Buffer-heavy queue signature",
            description: escapePrometheusTemplate(
              "When external memory exceeds half the JS heap, the dominant retainer is almost always native Buffer instances queued in a JS-side stream. Bun/Node `process.memoryUsage()` shape: `external` counts Buffer-backed bytes; a healthy steady-state pipeline keeps this ratio < 0.3. See the streambot post-incident plan for the differentiation table.",
            ),
          },
        },
        {
          alert: "StreambotEventLoopLag",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "streambot_nodejs_eventloop_lag_p99_seconds > 0.1",
          ),
          for: "2m",
          labels: { severity: "warning", category: "streaming" },
          annotations: {
            summary: "Streambot event-loop p99 > 100 ms — STW pauses likely",
            description: escapePrometheusTemplate(
              "Event-loop p99 stalls of > 100 ms align with V8/JSC major GC pauses on a multi-GB heap. The RTP send loop runs on the event loop — a 100 ms pause queues 3 frames at 30 fps, which Discord's receiver jitter buffer amplifies to a viewer-visible freeze.",
            ),
          },
        },
      ],
    },
  ];
}
