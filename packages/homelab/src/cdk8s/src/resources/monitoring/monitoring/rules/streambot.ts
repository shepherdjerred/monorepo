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
            "avg_over_time(streambot_ffmpeg_speed_ratio[1m]) > 1.25 and streambot_stream_active == 1",
          ),
          for: "1m",
          labels: { severity: "warning", category: "streaming" },
          annotations: {
            summary:
              "ffmpeg producing > 1.25× realtime sustained — readrate cap not holding",
            description: escapePrometheusTemplate(
              "The root cause of the 2026-06-14 stutter incident: ffmpeg's `-readrate` cap is missing or higher than the realtime send loop can consume. NUT-pipe consumer buffers accumulate, V8/JSC major GC pauses ≥ 200 ms, Discord viewers see ~1 s freezes. Set STREAM_READRATE=1.0 (the default) on streambot's deployment if this fires. Threshold is 1.25 (not 1.10) because bounded bursts above 1.0 are LEGITIMATE since PR #1542: the readrate_initial_burst pre-roll and post-dip catch-ups to the wall-clock line both briefly exceed realtime by design.",
            ),
          },
        },
        {
          alert: "StreambotPlaybackBehindSchedule",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "max(streambot_playback_behind_seconds) > 1 and on() streambot_stream_active == 1",
          ),
          for: "1m",
          labels: { severity: "critical", category: "streaming" },
          annotations: {
            summary:
              "Send pacer > 1 s behind schedule — viewers are experiencing stutter",
            description: escapePrometheusTemplate(
              "The direct viewer-facing stutter signal (added after the 2026-07-18 investigation): the paced send path is running more than 1 s behind its absolute schedule while a stream is active. Unlike speed_ratio (a production-side proxy), sustained growth here IS the user experience. Check the Streambot dashboard's 'Playback behind schedule' and 'Demux→pacer queue depth' panels: empty queues = producer-starved (transcode/readrate), full queues = pacer/sync-correction loss (see streambot_send_sync_events_total).",
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
        // --- voice connection loss & recovery ------------------------------------------
        {
          alert: "StreambotVoiceDisconnectsElevated",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(streambot_voice_disconnects_total[1h]) > 3",
          ),
          labels: { severity: "warning", category: "streaming" },
          annotations: {
            summary:
              "Discord dropped the streamer's voice session > 3 times in the last hour",
            description: escapePrometheusTemplate(
              'Repeated Discord-side voice session losses (see the 2026-07-03 mid-movie death investigation). Occasional drops are expected and auto-recovered; a burst points at network trouble on the node, Discord voice infra issues, or the account being flagged. Check `{app="media-streambot"} |= "voice gateway websocket closed"` in Loki for the close codes.',
            ),
          },
        },
        {
          alert: "StreambotVoiceReconnectExhausted",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(streambot_voice_reconnects_total{outcome="exhausted"}[15m]) > 0',
          ),
          labels: { severity: "critical", category: "streaming" },
          annotations: {
            summary:
              "Streambot gave up auto-reconnecting after a voice drop — playback stayed down",
            description: escapePrometheusTemplate(
              "Every reconnect attempt after a transient voice loss failed (no free userbot, join errors, or repeated immediate drops). The resume state file is preserved, so a restart or a manual /stream play resumes the movie. Investigate why rejoin failed before viewers do.",
            ),
          },
        },
        {
          alert: "StreambotVoiceReceiveUnready",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "(streambot_voice_receive_ready == 0 or streambot_voice_dave_ready == 0) and on (guild_id, channel_id) streambot_voice_sessions_active == 1",
          ),
          for: "2m",
          labels: { severity: "warning", category: "voice" },
          annotations: {
            summary:
              "An active Streambot voice receive path has been unready for two minutes",
            description: escapePrometheusTemplate(
              "The Discord receive or required DAVE decrypt path is not ready for guild {{ $labels.guild_id }} channel {{ $labels.channel_id }}. Open the Streambot Voice dashboard and correlate the session with transport logs before restarting it.",
            ),
          },
        },
        {
          alert: "StreambotVoiceIngressErrorsHigh",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '(sum(increase(streambot_voice_receive_packets_total{outcome=~"decrypt-error|malformed"}[10m])) + sum(increase(streambot_voice_decode_errors_total[10m]))) / clamp_min(sum(increase(streambot_voice_receive_packets_total[10m])), 1) > 0.05 and sum(increase(streambot_voice_receive_packets_total[10m])) >= 100',
          ),
          labels: { severity: "warning", category: "voice" },
          annotations: {
            summary:
              "More than 5% of Streambot voice ingress failed decrypt, decode, or validation",
            description: escapePrometheusTemplate(
              "At least 100 packets arrived in ten minutes and more than 5% were malformed, failed DAVE decryption, or failed Opus decoding. Inspect the ingress outcomes and correlated Loki logs before attributing the failure to wake detection.",
            ),
          },
        },
        {
          alert: "StreambotVoiceQuotaExhausted",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(streambot_voice_transcript_verifications_total{outcome="quota"}[15m])) + sum(increase(streambot_voice_cloud_verification_rate_limits_total{reason="quota"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "voice" },
          annotations: {
            summary: "Streambot exhausted its OpenAI voice quota",
            description: escapePrometheusTemplate(
              "The voice assistant recorded quota exhaustion during the last 15 minutes. Slash commands and playback remain available; restore or raise the dedicated OpenAI project budget before expecting voice commands to work.",
            ),
          },
        },
        {
          alert: "StreambotVoiceOpenAiFailures",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum(increase(streambot_voice_openai_failures_total[15m])) >= 3",
          ),
          labels: { severity: "warning", category: "voice" },
          annotations: {
            summary: "Streambot had three OpenAI voice failures in 15 minutes",
            description: escapePrometheusTemplate(
              "Use the Streambot Voice cloud-stage panels, then follow a trace into Tempo and its correlated logs in Loki to identify the failing OpenAI stage.",
            ),
          },
        },
        {
          alert: "StreambotVoiceReplyDeliveryFailure",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum(increase(streambot_voice_reply_send_failures_total[15m])) + sum(increase(streambot_voice_turn_delivery_failures_total[15m])) > 0",
          ),
          labels: { severity: "warning", category: "voice" },
          annotations: {
            summary: "A Streambot voice reply failed delivery",
            description: escapePrometheusTemplate(
              "At least one assistant response failed while draining to Discord in the last 15 minutes. Inspect reply-delivery spans and the receive/session readiness panels for a simultaneous Discord voice loss.",
            ),
          },
        },
        {
          alert: "StreambotVoiceCaptureFailures",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(streambot_voice_capture_uploads_total{outcome="failure"}[15m])) + sum(increase(streambot_voice_capture_drops_total[15m])) >= 3',
          ),
          labels: { severity: "warning", category: "voice" },
          annotations: {
            summary:
              "Three Streambot diagnostic captures failed or were dropped",
            description: escapePrometheusTemplate(
              "Capture failures do not fail voice commands, but diagnostic evidence is being lost. Check SeaweedFS reachability, credentials, object upload logs, and queue capacity.",
            ),
          },
        },
        {
          alert: "StreambotVoiceCaptureQueuePressure",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "streambot_voice_capture_queue_bytes > 100 * 1024 * 1024",
          ),
          for: "5m",
          labels: { severity: "warning", category: "voice" },
          annotations: {
            summary:
              "Streambot voice capture queue has retained more than 100 MiB for five minutes",
            description: escapePrometheusTemplate(
              "The bounded 128 MiB capture queue is close to dropping new evidence. Investigate SeaweedFS upload latency and failures; do not increase the queue until the storage path is understood.",
            ),
          },
        },
        {
          alert: "StreambotVoiceTurnStuck",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "streambot_voice_turn_age_seconds > 35",
          ),
          labels: { severity: "warning", category: "voice" },
          annotations: {
            summary: "A Streambot voice turn is older than 35 seconds",
            description: escapePrometheusTemplate(
              "The active turn in guild {{ $labels.guild_id }} channel {{ $labels.channel_id }} exceeded the expected end-to-end budget. Follow its active trace to the verifier, OpenAI, tool, or reply stage that has not terminated.",
            ),
          },
        },
        {
          alert: "StreambotVoicePlaybackDuckStuck",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "streambot_voice_duck_state == 1 and on (guild_id, channel_id) streambot_voice_turn_age_seconds == 0",
          ),
          for: "60s",
          labels: { severity: "critical", category: "voice" },
          annotations: {
            summary:
              "Streambot playback remained ducked after the voice turn ended",
            description: escapePrometheusTemplate(
              "Playback has stayed ducked for 60 seconds with no active turn in guild {{ $labels.guild_id }} channel {{ $labels.channel_id }}. This is a user-visible stuck state; inspect reply teardown and restore the session.",
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
