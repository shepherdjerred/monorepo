---
title: Streambot voice reference
description: Voice configuration, diagnostic commands, capture schema, metric families, traces, logs, limits, and retention.
sidebar:
  order: 7
---

This page lists the Streambot voice contracts. For rationale, see
[Streambot voice assistant](/explanation/streambot-voice/). For an operating
procedure, see [Diagnose Streambot voice](/how-to/diagnose-streambot-voice/).

## Environment variables

Streambot parses these variables once at boot. Invalid values and missing
required settings fail startup.

| Variable                       | Default                                     | Meaning                                                                        |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------ |
| `VOICE_ASSISTANT_ENABLED`      | `false`                                     | Global voice on/off and rollback control.                                      |
| `OPENAI_API_KEY`               | —                                           | Required when voice is enabled.                                                |
| `VOICE_ASSETS_DIR`             | `/opt/streambot/voice`                      | Directory containing the pinned local models.                                  |
| `VOICE_KWS_RUNTIME`            | `auto`                                      | `auto`, `native`, or `wasm`; `auto` prefers native.                            |
| `VOICE_PRE_ROLL_MS`            | `2000`                                      | Rolling input retained before a candidate; maximum `3000`.                     |
| `VOICE_MAX_UTTERANCE_MS`       | `15000`                                     | Audio cap after a candidate; maximum `15000`.                                  |
| `VOICE_TRANSACTION_TIMEOUT_MS` | `30000`                                     | Whole cloud turn, including spoken reply; maximum `30000`.                     |
| `VOICE_CAPTURE_ENABLED`        | `false`                                     | Enables wake-candidate and manual debug capture upload.                        |
| `VOICE_CAPTURE_BUCKET`         | —                                           | Required when capture is enabled; production uses `streambot-voice-captures`.  |
| `S3_ENDPOINT`                  | —                                           | Required capture S3 endpoint. Production uses the in-cluster SeaweedFS S3 API. |
| `S3_FORCE_PATH_STYLE`          | `true`                                      | Uses path-style S3 requests.                                                   |
| `AWS_REGION`                   | `us-east-1`                                 | S3 signing region.                                                             |
| `AWS_ACCESS_KEY_ID`            | —                                           | Required when capture is enabled.                                              |
| `AWS_SECRET_ACCESS_KEY`        | —                                           | Required when capture is enabled.                                              |
| `TELEMETRY_ENABLED`            | `false`                                     | Enables controlled OTLP trace and log export.                                  |
| `TELEMETRY_SERVICE_NAME`       | `streambot`                                 | OpenTelemetry `service.name`.                                                  |
| `OTLP_ENDPOINT`                | `http://tempo.tempo.svc.cluster.local:4318` | Base OTLP/HTTP trace endpoint; Streambot appends `/v1/traces`.                 |
| `LOKI_OTLP_ENDPOINT`           | `http://loki-gateway.loki/otlp/v1/logs`     | Complete OTLP/HTTP log endpoint.                                               |

## Diagnostic commands

The `voice-debug` group is admin-only and requires the admin to be in the
active playback session it targets.

| Command                                  | Result                                                              |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `/stream voice-debug start`              | Starts a 60-second private decoded-audio window.                    |
| `/stream voice-debug start duration:120` | Starts a window from 10 through 300 whole seconds.                  |
| `/stream voice-debug status`             | Reports this session's active capture ID, age, speakers, and bytes. |
| `/stream voice-debug stop`               | Finalizes this session's window and queues its upload.              |

Only one manual window may exist in the process. A command from another
session reports that a window is active elsewhere without exposing its
contents. Session teardown, duration expiry, an eighth-speaker overflow, the
96 MiB boundary, or process shutdown finalizes the active window.

## Capture object layout

All keys use UTC dates:

```text
voice-captures/YYYY/MM/DD/<capture-id>/
├── speaker.wav          # wake-candidate capture
├── speaker-001.wav      # manual window, one file per decoded speaker
├── speaker-002.wav
└── manifest.json        # uploaded last; capture commit marker
```

Audio is lossless PCM signed 16-bit little-endian WAV, 16 kHz, mono. A rejected
wake candidate contains its verifier window. An accepted candidate contains
the full endpointed utterance. A manual window contains the same per-speaker
decoded samples supplied to wake processing. It does not mix speakers.

The private bucket expires objects below `voice-captures/` after 90 days. It is
not public and is not backed up outside SeaweedFS.

## Manifest version 1

`manifest.json` is a strict JSON object. Unknown fields fail validation in the
writer.

| Field                                 | Content                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `schemaVersion`                       | Literal `1`.                                                                                         |
| `captureId`, `kind`                   | UUID and `wake-candidate` or `debug-window`.                                                         |
| `startedAt`, `endedAt`, `committedAt` | ISO 8601 timestamps.                                                                                 |
| `guildId`, `channelId`, `userId`      | Discord identity; `userId` is present for a wake candidate.                                          |
| `traceId`                             | 32-character trace ID when telemetry produced one.                                                   |
| `terminalOutcome`                     | Final bounded lifecycle outcome.                                                                     |
| `truncated`, `truncationReason`       | Whether and why a manual capture hit a bound.                                                        |
| `audio[]`                             | Object key, filename, optional user ID, SHA-256, byte count, duration, rate, channels, and encoding. |
| `speakerMappings[]`                   | Manual-window filename-to-user mapping.                                                              |
| `wake`                                | Fragment, score, fragment timestamp, detection time, and verifier evidence.                          |
| `endpoint`                            | Terminal reason, speech flag, sample count, duration, and DTX duration.                              |
| `transcript`, `normalizedCommand`     | Cloud transcript and command after prefix normalization.                                             |
| `tools[]`                             | Validated name, arguments, result, outcome, and duration.                                            |
| `cloudOutcome`, `cloudUsage`          | Cloud terminal class and validated usage record.                                                     |
| `reply`                               | Reply outcome, packets, bytes, and duration.                                                         |
| `errors[]`                            | Stage, bounded error class, and message.                                                             |

Audio objects upload concurrently before the manifest. The manifest uploads
only after every audio upload succeeds. The S3 client attempts each request at
most three times.

## Telemetry content

Streambot creates a root `streambot.voice.attempt` span for every wake
candidate. Controlled children cover transport join, local verification,
endpointing, OpenAI connect/transcription/response, every tool, and reply
delivery. OpenAI SDK tracing remains disabled.

Structured stdout JSON is retained. When telemetry is enabled, the same log
record is emitted through OTLP with its active trace and span IDs. Private
traces and logs may contain guild, channel, and speaker IDs; transcripts;
normalized commands; capture IDs; scores and timings; validated tool
arguments/results; and bounded error classes. They never contain credentials
or raw audio.

## Prometheus metrics

Only active-session gauges carry Discord IDs (`guild_id`, `channel_id`). Those
series are removed at teardown. Counters and histograms use finite labels only.

| Area               | Metric families                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session readiness  | `streambot_voice_sessions_active`, `streambot_voice_receive_ready`, `streambot_voice_dave_required`, `streambot_voice_dave_ready`, `streambot_voice_speaking_speakers`                                                                                                                            |
| Ingress freshness  | `streambot_voice_last_packet_timestamp_seconds`, `streambot_voice_last_decoded_timestamp_seconds`                                                                                                                                                                                                 |
| Receive and decode | `streambot_voice_receive_packets_total`, `streambot_voice_receive_bytes_total`, `streambot_voice_decoded_seconds_total`, `streambot_voice_decode_errors_total`, `streambot_voice_input_drops_total`                                                                                               |
| Activation         | `streambot_voice_wake_candidates_total`, `streambot_voice_wake_score`, `streambot_voice_local_verifications_total`, `streambot_voice_endpoint_outcomes_total`, `streambot_voice_utterance_duration_seconds`, `streambot_voice_dtx_duration_seconds`                                               |
| Cloud and tools    | `streambot_voice_cloud_requests_total`, `streambot_voice_transcript_verifications_total`, `streambot_voice_openai_failures_total`, `streambot_voice_audio_tokens_total`, `streambot_voice_transcription_usage_total`, `streambot_voice_tool_calls_total`, `streambot_voice_tool_duration_seconds` |
| Reply and state    | `streambot_voice_reply_duration_seconds`, `streambot_voice_reply_bytes_total`, `streambot_voice_reply_packets_total`, `streambot_voice_reply_send_failures_total`, `streambot_voice_duck_state`, `streambot_voice_duck_duration_seconds`, `streambot_voice_turn_age_seconds`                      |
| Captures and OTLP  | `streambot_voice_capture_queue_depth`, `streambot_voice_capture_queue_bytes`, `streambot_voice_capture_upload_duration_seconds`, `streambot_voice_capture_uploads_total`, `streambot_voice_capture_drops_total`, `streambot_telemetry_exports_total`                                              |

Five minutes without packets emits one info log. The next packet emits one
recovery log. There is intentionally no inactivity alert.

## Fixed limits

| Limit                                    | Value                                                              |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Verification window close                | Per-fragment tail plus 150 ms; 1250 ms fallback without timestamps |
| Audio retained after verifier acceptance | 300 ms                                                             |
| Packet gap treated as DTX                | 120 ms                                                             |
| Synthetic silence per DTX tick           | 100 ms                                                             |
| Cloud verification burst per session     | 2                                                                  |
| Cloud verifications per rolling minute   | 5                                                                  |
| Rejected-transcript cooldown             | 3 seconds                                                          |
| Quota-refusal backoff                    | 1 hour                                                             |
| Mutating tools per wake                  | 1                                                                  |
| Go Live ducking during reply             | 20% volume                                                         |
| Manual debug duration                    | 10–300 seconds; default 60                                         |
| Concurrent manual debug windows          | 1 per process                                                      |
| Speakers per manual window               | 8; the next speaker finalizes as truncated                         |
| Manual decoded-audio buffer              | 96 MiB; crossing it finalizes as truncated                         |
| Capture upload queue                     | 2 workers, 128 MiB retained                                        |
| S3 attempts                              | 3 per request                                                      |
| Capture retention                        | 90 days                                                            |

## Model assets

The image fetches and checksum-verifies all assets at build time. Voice-enabled
startup fails if any asset is missing or invalid.

| Asset                     | Source                                       |
| ------------------------- | -------------------------------------------- |
| sherpa KWS zipformer      | Pinned sherpa-onnx `kws-models` release      |
| `silero_vad.onnx`         | Pinned sherpa-onnx `asr-models` release      |
| `melspectrogram.onnx`     | Repository `packages/streambot/assets/voice` |
| `embedding_model.onnx`    | Repository `packages/streambot/assets/voice` |
| `hey_streambot.onnx`      | Repository `packages/streambot/assets/voice` |
| `hey-streambot-smoke.wav` | Generated positive smoke sample              |
| `wake-verifier.json`      | SHA-256s and training attestation            |

## Related

- [Streambot voice assistant](/explanation/streambot-voice/) — architecture and trade-offs
- [Diagnose Streambot voice](/how-to/diagnose-streambot-voice/) — production diagnostic workflow
- [Run the Streambot voice probe](/how-to/run-the-streambot-voice-probe/) — local macOS probe
