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
        // Canonical stall detector per ffmpeg-user: trust out_time velocity rather than speed= alone.
        {
          alert: "StreambotEncoderStalled",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "rate(streambot_ffmpeg_out_time_seconds_total[1m]) < 0.5 and on(namespace, pod, hardware) streambot_ffmpeg_speed_ratio >= 0 and on(namespace, pod) streambot_stream_active > 0",
          ),
          for: "30s",
          labels: { severity: "critical", category: "streaming" },
          annotations: {
            summary: "Stream video encoder has stalled",
            description: escapePrometheusTemplate(
              "Streambot's ffmpeg encoder is advancing media time at less than 0.5x realtime while a stream is active, stalling playback for Discord viewers. The encoder subprocess may have died, deadlocked on stdio, or blocked on input demuxing. Check Streambot pod logs and active ffmpeg processes to recover the stream.",
            ),
          },
        },
        // Root cause of the 2026-06-14 stutter incident: without a working -readrate cap,
        // NUT-pipe consumer buffers accumulate, V8/JSC major GC pauses exceed 200 ms, and
        // Discord viewers see ~1 s freezes. Threshold is 1.25 (not 1.10) because bounded
        // bursts above 1.0 are expected since PR #1542 (readrate_initial_burst pre-roll and
        // post-dip catch-ups to wall-clock time).
        {
          alert: "StreambotEncoderProducerAhead",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "avg_over_time(streambot_ffmpeg_speed_ratio[1m]) > 1.25 and on(namespace, pod) streambot_stream_active > 0 unless on(namespace, pod, hardware) (streambot_stream_live == 1)",
          ),
          for: "1m",
          labels: { severity: "warning", category: "streaming" },
          annotations: {
            summary: "Stream video is running ahead of audio",
            description: escapePrometheusTemplate(
              "Streambot's ffmpeg encoder is producing media faster than 1.25x realtime, causing consumer buffers to grow and triggering GC pauses that freeze playback for Discord viewers. Verify that STREAM_READRATE=1.0 is configured on the Streambot deployment and that -readrate is applied to the transcode command.",
            ),
          },
        },
        // Direct viewer-facing stutter signal added after the 2026-07-18 investigation.
        // Unlike speed_ratio (a production-side proxy), sustained growth here directly
        // reflects viewer stutter; streambot_send_sync_events_total tracks sync-correction loss.
        {
          alert: "StreambotPlaybackBehindSchedule",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "max(streambot_playback_behind_seconds) > 1 and on() max(streambot_stream_active) > 0",
          ),
          for: "1m",
          labels: { severity: "critical", category: "streaming" },
          annotations: {
            summary: "Stream playback is falling behind and stuttering",
            description: escapePrometheusTemplate(
              "Streambot's paced send path is more than 1 second behind schedule during an active stream, causing visible stutter for Discord viewers. Check the Streambot dashboard's 'Playback behind schedule' and 'Demux→pacer queue depth' panels: empty queues point to encoder starvation, while full queues point to send-pacer lag.",
            ),
          },
        },
        // Producer slower than consumer (Mux stream-drift pattern): the startup buffer drains
        // without replacement until playback stalls.
        {
          alert: "StreambotEncoderFallingBehind",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "avg_over_time(streambot_ffmpeg_speed_ratio[1m]) < 0.95 and on(namespace, pod) streambot_stream_active > 0",
          ),
          for: "2m",
          labels: { severity: "critical", category: "streaming" },
          annotations: {
            summary: "Stream video encoder cannot keep up",
            description: escapePrometheusTemplate(
              "Streambot's ffmpeg encoder is running below 0.95x realtime during an active stream, draining the startup buffer until Discord playback stalls. Check node CPU saturation, GPU contention on /dev/dri/renderD128, and media source read throughput.",
            ),
          },
        },
        // Stops in fluent-ffmpeg progress events usually indicate an undrained stderr buffer
        // blocking the child write (ffmpeg-python#195 deadlock), an encoder crash, or a segfault.
        {
          alert: "StreambotProgressStalled",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "streambot_ffmpeg_progress_age_seconds > 5 and on(namespace, pod) streambot_stream_active > 0",
          ),
          for: "30s",
          labels: { severity: "critical", category: "streaming" },
          annotations: {
            summary: "Stream video encoder stopped responding",
            description: escapePrometheusTemplate(
              "Streambot has not received an ffmpeg progress update for over 5 seconds during an active stream, indicating the encoder subprocess has deadlocked or crashed. Inspect pod logs with kubectl logs and check running child processes in the Streambot container.",
            ),
          },
        },
        // --- voice connection loss & recovery ------------------------------------------
        // Added after the 2026-07-03 mid-movie voice session drop investigation.
        {
          alert: "StreambotVoiceDisconnectsElevated",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "increase(streambot_voice_disconnects_total[1h]) > 3",
          ),
          labels: { severity: "warning", category: "streaming" },
          annotations: {
            summary:
              "Streambot Discord voice session is disconnecting repeatedly",
            description: escapePrometheusTemplate(
              'Discord dropped Streambot voice sessions more than 3 times in the past hour, interrupting active playback even when auto-recovery succeeds. Inspect `{app="media-streambot"} |= "voice gateway websocket closed"` in Loki for gateway close codes and check node network health or Discord voice status.',
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
            summary: "Streambot failed to reconnect to Discord voice",
            description: escapePrometheusTemplate(
              "Streambot exhausted all automatic reconnect attempts after losing its Discord voice session, leaving stream playback stopped. Check Streambot logs for userbot availability or voice join errors, then restart the pod or run /stream play to resume from saved state.",
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
            summary: "Streambot cannot hear Discord voice chat",
            description: escapePrometheusTemplate(
              "The Discord voice receive or DAVE decryption path has been unready for 2 minutes in guild {{ $labels.guild_id }} channel {{ $labels.channel_id }}, blocking voice commands. Check the Streambot Voice dashboard and correlate the session with voice transport logs before restarting.",
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
            summary: "Streambot is receiving corrupted Discord audio",
            description: escapePrometheusTemplate(
              "More than 5% of incoming Discord voice packets over the last 10 minutes were malformed or failed DAVE decryption or Opus decoding, degrading voice command recognition. Inspect voice ingress error breakdowns on the Streambot Voice dashboard and check correlated Loki logs.",
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
              "Streambot's voice assistant hit OpenAI quota limits in the last 15 minutes, disabling voice commands while slash commands and media playback remain available. Restore or increase the dedicated OpenAI project budget to re-enable voice interaction.",
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
            summary: "Streambot is failing OpenAI voice requests",
            description: escapePrometheusTemplate(
              "Streambot recorded at least 3 OpenAI voice pipeline failures in the last 15 minutes, causing spoken assistant commands to fail. Check the Streambot Voice cloud-stage dashboard panels and follow failing traces in Tempo and Loki to identify the broken stage.",
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
            summary: "Streambot failed to deliver a spoken voice reply",
            description: escapePrometheusTemplate(
              "At least one Streambot voice assistant reply failed to play back into Discord during the last 15 minutes. Inspect reply-delivery trace spans and check the voice session readiness panels for a concurrent Discord voice disconnect.",
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
              "Streambot is dropping or failing voice diagnostic captures",
            description: escapePrometheusTemplate(
              "At least 3 Streambot voice diagnostic captures failed upload or were dropped in the last 15 minutes; voice commands still work, but debugging audio evidence is being lost. Check SeaweedFS reachability, S3 credentials, upload logs, and capture queue usage.",
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
            summary: "Streambot voice diagnostic capture queue is nearly full",
            description: escapePrometheusTemplate(
              "Streambot's 128 MiB diagnostic capture queue has held over 100 MiB for 5 minutes and is close to dropping new voice captures. Investigate SeaweedFS upload latency and errors in Streambot logs rather than raising the queue limit.",
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
            summary: "Streambot voice assistant turn is stuck",
            description: escapePrometheusTemplate(
              "An active voice assistant turn in guild {{ $labels.guild_id }} channel {{ $labels.channel_id }} has been running for over 35 seconds, blocking subsequent voice interaction in that session. Inspect the active trace in Tempo to find whether verification, OpenAI, tool execution, or reply playback is hung.",
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
            summary: "Stream audio is stuck at low volume",
            description: escapePrometheusTemplate(
              "Stream audio volume in guild {{ $labels.guild_id }} channel {{ $labels.channel_id }} has remained lowered for 60 seconds after the voice assistant turn ended, leaving media muffled for viewers. Inspect voice reply teardown logs and restart or rejoin the stream session to restore normal volume.",
            ),
          },
        },
        // --- web remote --------------------------------------------------------------
        // Each rule carries a minimum-volume floor so one failed request on a quiet evening
        // cannot fire it. Client aborts are excluded from every denominator.
        {
          alert: "StreambotWebServerErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            '((sum(increase(streambot_web_requests_total{status_class="5xx"}[15m])) or vector(0)) + (sum(increase(streambot_web_requests_total{code="unavailable",status_class!~"5xx|aborted"}[15m])) or vector(0))) / sum(increase(streambot_web_requests_total{status_class!="aborted"}[15m])) > 0.05 and sum(increase(streambot_web_requests_total{status_class!="aborted"}[15m])) >= 50',
          ),
          for: "5m",
          labels: { severity: "warning", category: "web" },
          annotations: {
            summary:
              "More than 5% of Streambot web requests failed with a server error",
            description: escapePrometheusTemplate(
              "At least 50 web API requests arrived in 15 minutes and more than 5% returned 5xx or an `unavailable` failure. Open the Streambot Web Remote dashboard (uid streambot-web), read the error rate by code, then follow the reference id of a failing request into Tempo and Loki as described in the wiki how-to diagnose-streambot-web.",
            ),
          },
        },
        {
          alert: "StreambotWebTimeToPlaybackSlow",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "histogram_quantile(0.95, sum by (transport, le) (rate(streambot_web_time_to_playback_seconds_bucket[30m]))) > 20 and on (transport) sum by (transport) (increase(streambot_web_time_to_playback_seconds_count[30m])) >= 10",
          ),
          for: "10m",
          labels: { severity: "warning", category: "web" },
          annotations: {
            summary:
              "Streambot web play commands take more than 20 seconds to start streaming (p95)",
            description: escapePrometheusTemplate(
              "The p95 time from an accepted web play command to the item streaming exceeded 20 seconds for transport {{ $labels.transport }}, with at least 10 starts in 30 minutes. Compare the dashboard's time-to-playback and search-latency panels, then check the pipeline-health alerts above for encoder or voice-session trouble.",
            ),
          },
        },
        {
          alert: "StreambotMusicSearchProviderFailing",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum by (provider) (increase(streambot_music_provider_requests_total{operation!="parser",outcome=~"unavailable|timeout|error"}[30m])) / sum by (provider) (increase(streambot_music_provider_requests_total{operation!="parser",outcome!="aborted"}[30m])) > 0.5 and sum by (provider) (increase(streambot_music_provider_requests_total{operation!="parser",outcome!="aborted"}[30m])) >= 20',
          ),
          for: "10m",
          labels: { severity: "warning", category: "web" },
          annotations: {
            summary:
              "A Streambot music search provider is failing more than half its calls",
            description: escapePrometheusTemplate(
              "Provider {{ $labels.provider }} returned unavailable, timeout or error for more than 50% of at least 20 calls in 30 minutes. Search results for its kinds are degraded or empty. Check the dashboard's music provider panels and the provider's upstream status.",
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
            summary: "Streambot is sending late video frames",
            description: escapePrometheusTemplate(
              "Streambot's video send loop is missing its frame deadline on more than 0.5 frames per second (>1.5% at 30 fps), causing visible playback jitter for Discord viewers. Check Streambot event-loop lag for GC pauses and encoder speed ratio on the Streambot dashboard.",
            ),
          },
        },
        // --- JS heap / queue health --------------------------------------------------
        // Unbounded-queue signature: pair with StreambotExternalBufferHeavy (external/heap > 0.5)
        // to distinguish buffered ffmpeg pipe output from a pure JS object leak.
        {
          alert: "StreambotHeapGrowing",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "deriv(streambot_nodejs_heap_size_used_bytes[5m]) > (10 * 1024 * 1024) / 60",
          ),
          for: "5m",
          labels: { severity: "warning", category: "streaming" },
          annotations: {
            summary: "Streambot memory usage is climbing steadily",
            description: escapePrometheusTemplate(
              "Streambot's JS heap has grown by more than 10 MiB per minute for 5 minutes, risking long GC pauses or pod OOM kills during active playback. Check whether external buffer memory is also elevated (indicating RTP send cannot drain the ffmpeg pipe) or inspect heap usage for a memory leak.",
            ),
          },
        },
        // In Bun/Node process.memoryUsage(), `external` counts native Buffer-backed bytes;
        // a healthy steady-state Streambot pipeline keeps external / heapUsed below 0.3.
        {
          alert: "StreambotExternalBufferHeavy",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "streambot_nodejs_external_memory_bytes / streambot_nodejs_heap_size_used_bytes > 0.5",
          ),
          for: "5m",
          labels: { severity: "warning", category: "streaming" },
          annotations: {
            summary: "Streambot media buffer memory is backing up",
            description: escapePrometheusTemplate(
              "Streambot's native Buffer memory exceeds half of its JS heap size, indicating media frames are backing up in JS stream queues and risking GC stalls. Check encoder readrate settings and RTP send-loop throughput on the Streambot dashboard.",
            ),
          },
        },
        // Event-loop p99 stalls > 100 ms typically align with V8/JSC major GC pauses on a
        // multi-GB heap; at 30 fps a 100 ms stall queues 3 frames, which Discord's receiver
        // jitter buffer amplifies into a viewer-visible freeze.
        {
          alert: "StreambotEventLoopLag",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "streambot_nodejs_eventloop_lag_p99_seconds > 0.1",
          ),
          for: "2m",
          labels: { severity: "warning", category: "streaming" },
          annotations: {
            summary: "Streambot main thread is lagging and freezing video",
            description: escapePrometheusTemplate(
              "Streambot's p99 event-loop lag has exceeded 100 ms for 2 minutes, delaying the RTP send loop and causing video freezes for Discord viewers. Check Streambot heap size, external buffer growth, and pod CPU throttling to find what is blocking the event loop.",
            ),
          },
        },
      ],
    },
  ];
}
