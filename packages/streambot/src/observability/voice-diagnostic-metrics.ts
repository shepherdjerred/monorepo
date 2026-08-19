import { Counter, Gauge, Histogram } from "prom-client";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";

// Discord IDs belong only on live-state gauges. Teardown removes every such series; all durable
// counters and histograms below use finite, reviewed labels.
const voiceSessionLabels = ["guild_id", "channel_id"] as const;

export const voiceSessionsActive = new Gauge({
  name: "streambot_voice_sessions_active",
  help: "Active Streambot voice-assistant sessions",
  labelNames: voiceSessionLabels,
  registers: [register],
});

export const voiceReceiveReady = new Gauge({
  name: "streambot_voice_receive_ready",
  help: "Whether an active session has a ready Discord receive path",
  labelNames: voiceSessionLabels,
  registers: [register],
});

export const voiceDaveRequired = new Gauge({
  name: "streambot_voice_dave_required",
  help: "Whether Discord requires DAVE for the active receive path",
  labelNames: voiceSessionLabels,
  registers: [register],
});

export const voiceDaveReady = new Gauge({
  name: "streambot_voice_dave_ready",
  help: "Whether DAVE is ready, or not required, for the active receive path",
  labelNames: voiceSessionLabels,
  registers: [register],
});

export const voiceSpeakingSpeakers = new Gauge({
  name: "streambot_voice_speaking_speakers",
  help: "Mapped speakers currently marked speaking in an active session",
  labelNames: voiceSessionLabels,
  registers: [register],
});

export const voiceLastPacketTimestampSeconds = new Gauge({
  name: "streambot_voice_last_packet_timestamp_seconds",
  help: "Unix timestamp of the latest Discord voice packet for an active session",
  labelNames: voiceSessionLabels,
  registers: [register],
});

export const voiceLastDecodedTimestampSeconds = new Gauge({
  name: "streambot_voice_last_decoded_timestamp_seconds",
  help: "Unix timestamp of the latest 16kHz decoded input for an active session",
  labelNames: voiceSessionLabels,
  registers: [register],
});

export const voiceTurnAgeSeconds = new Gauge({
  name: "streambot_voice_turn_age_seconds",
  help: "Age of the active voice command turn, or zero when none is active",
  labelNames: voiceSessionLabels,
  registers: [register],
});

export const voiceDuckState = new Gauge({
  name: "streambot_voice_duck_state",
  help: "Whether playback is ducked for assistant speech in an active session",
  labelNames: voiceSessionLabels,
  registers: [register],
});

export const voiceReceivePacketsTotal = new Counter({
  name: "streambot_voice_receive_packets_total",
  help: "Discord receive packets by bounded transport outcome",
  labelNames: ["outcome"] as const,
  registers: [register],
});

export const voiceReceiveBytesTotal = new Counter({
  name: "streambot_voice_receive_bytes_total",
  help: "Discord receive packet bytes by bounded transport outcome",
  labelNames: ["outcome"] as const,
  registers: [register],
});

export const voiceDecodedSecondsTotal = new Counter({
  name: "streambot_voice_decoded_seconds_total",
  help: "Decoded 16kHz mono input seconds reaching the wake path",
  registers: [register],
});

export const voiceInputDropsTotal = new Counter({
  name: "streambot_voice_input_drops_total",
  help: "Voice input dropped before wake processing by bounded reason",
  labelNames: ["reason"] as const,
  registers: [register],
});

export const voiceWakeScore = new Histogram({
  name: "streambot_voice_wake_score",
  help: "Permissive wake detector score by finite model fragment",
  labelNames: ["fragment"] as const,
  buckets: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
  registers: [register],
});

export const voiceEndpointOutcomesTotal = new Counter({
  name: "streambot_voice_endpoint_outcomes_total",
  help: "Candidate endpoint outcomes by bounded reason",
  labelNames: ["reason"] as const,
  registers: [register],
});

export const voiceUtteranceDurationSeconds = new Histogram({
  name: "streambot_voice_utterance_duration_seconds",
  help: "Captured candidate duration by terminal outcome",
  labelNames: ["outcome"] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15],
  registers: [register],
});

export const voiceDtxDurationSeconds = new Histogram({
  name: "streambot_voice_dtx_duration_seconds",
  help: "Synthetic DTX silence inserted into a candidate",
  buckets: [0.02, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

export const voiceCloudRequestsTotal = new Counter({
  name: "streambot_voice_cloud_requests_total",
  help: "OpenAI requests by bounded stage and outcome",
  labelNames: ["stage", "outcome"] as const,
  registers: [register],
});

export const voiceToolDurationSeconds = new Histogram({
  name: "streambot_voice_tool_duration_seconds",
  help: "Validated voice tool execution duration by tool and outcome",
  labelNames: ["tool", "outcome"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const voiceReplyDurationSeconds = new Histogram({
  name: "streambot_voice_reply_duration_seconds",
  help: "Assistant reply drain duration by outcome",
  labelNames: ["outcome"] as const,
  buckets: [0.02, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30],
  registers: [register],
});

export const voiceReplyBytesTotal = new Counter({
  name: "streambot_voice_reply_bytes_total",
  help: "Assistant Opus bytes sent over Discord voice",
  registers: [register],
});

export const voiceDuckDurationSeconds = new Histogram({
  name: "streambot_voice_duck_duration_seconds",
  help: "Playback duck duration by terminal outcome",
  labelNames: ["outcome"] as const,
  buckets: [0.02, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [register],
});

export const voiceCaptureQueueDepth = new Gauge({
  name: "streambot_voice_capture_queue_depth",
  help: "Voice diagnostic capture jobs waiting or uploading",
  registers: [register],
});

export const voiceCaptureQueueBytes = new Gauge({
  name: "streambot_voice_capture_queue_bytes",
  help: "Voice diagnostic capture bytes retained in the upload queue",
  registers: [register],
});

export const voiceCaptureUploadDurationSeconds = new Histogram({
  name: "streambot_voice_capture_upload_duration_seconds",
  help: "Voice capture upload duration by outcome",
  labelNames: ["outcome"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

export const voiceCaptureUploadsTotal = new Counter({
  name: "streambot_voice_capture_uploads_total",
  help: "Voice capture upload jobs by outcome",
  labelNames: ["outcome"] as const,
  registers: [register],
});

export const voiceCaptureDropsTotal = new Counter({
  name: "streambot_voice_capture_drops_total",
  help: "Voice diagnostic captures dropped by bounded reason",
  labelNames: ["reason"] as const,
  registers: [register],
});

export const telemetryExportsTotal = new Counter({
  name: "streambot_telemetry_exports_total",
  help: "OTLP export batches by signal and outcome",
  labelNames: ["signal", "outcome"] as const,
  registers: [register],
});

type ActiveVoiceSessionLabels = {
  readonly guildId: string;
  readonly channelId: string;
};

function activeLabels(labels: ActiveVoiceSessionLabels) {
  return { guild_id: labels.guildId, channel_id: labels.channelId };
}

export function initializeVoiceSessionMetrics(
  labels: ActiveVoiceSessionLabels,
): void {
  const values = activeLabels(labels);
  voiceSessionsActive.set(values, 1);
  voiceReceiveReady.set(values, 0);
  voiceDaveRequired.set(values, 0);
  voiceDaveReady.set(values, 0);
  voiceSpeakingSpeakers.set(values, 0);
  voiceLastPacketTimestampSeconds.set(values, 0);
  voiceLastDecodedTimestampSeconds.set(values, 0);
  voiceTurnAgeSeconds.set(values, 0);
  voiceDuckState.set(values, 0);
}

export function clearVoiceSessionMetrics(
  labels: ActiveVoiceSessionLabels,
): void {
  const values = activeLabels(labels);
  voiceSessionsActive.remove(values);
  voiceReceiveReady.remove(values);
  voiceDaveRequired.remove(values);
  voiceDaveReady.remove(values);
  voiceSpeakingSpeakers.remove(values);
  voiceLastPacketTimestampSeconds.remove(values);
  voiceLastDecodedTimestampSeconds.remove(values);
  voiceTurnAgeSeconds.remove(values);
  voiceDuckState.remove(values);
}
