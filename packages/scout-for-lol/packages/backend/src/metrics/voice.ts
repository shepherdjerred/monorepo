import { Counter, Gauge, Histogram } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * The `scout_voice_*` family for the "Hey Scout" voice assistant. Instruments
 * are defined here (metrics stays a leaf layer); the adapters that satisfy the
 * `@shepherdjerred/voice-assistant` metric ports live in
 * `src/voice-assistant/metrics-ports.ts`. Every label set is finite by
 * construction — stages, outcomes, and tool names come from closed sets, and
 * nothing here is ever labeled by guild, user, or transcript content.
 */

export const scoutVoiceWakeCandidatesTotal = new Counter({
  name: "scout_voice_wake_candidates_total",
  help: "Permissive sherpa keyword candidates observed.",
  registers: [registry],
});

export const scoutVoiceWakeDetectionsTotal = new Counter({
  name: "scout_voice_wake_detections_total",
  help: "Wake phrases accepted by the local verifier cascade.",
  registers: [registry],
});

export const scoutVoiceLocalVerificationsTotal = new Counter({
  name: "scout_voice_local_verifications_total",
  help: "Local wake-phrase verifier decisions by outcome.",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

export const scoutVoiceTranscriptVerificationsTotal = new Counter({
  name: "scout_voice_transcript_verifications_total",
  help: "Cloud transcript wake-prefix gate decisions by outcome.",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

export const scoutVoiceTurnsTotal = new Counter({
  name: "scout_voice_turns_total",
  help: "Completed voice turns by outcome.",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

export const scoutVoiceTurnDeliveryFailuresTotal = new Counter({
  name: "scout_voice_turn_delivery_failures_total",
  help: "Voice turns the audio lifecycle failed to deliver to the handler.",
  registers: [registry],
});

export const scoutVoiceRateLimitedTotal = new Counter({
  name: "scout_voice_rate_limited_total",
  help: "Wakes refused by the cloud verification rate limiter by reason.",
  labelNames: ["reason"] as const,
  registers: [registry],
});

export const scoutVoiceAudioTokensTotal = new Counter({
  name: "scout_voice_audio_tokens_total",
  help: "OpenAI Realtime audio tokens billed by direction.",
  labelNames: ["direction"] as const,
  registers: [registry],
});

export const scoutVoiceTranscriptionUsageTotal = new Counter({
  name: "scout_voice_transcription_usage_total",
  help: "OpenAI transcription usage by unit and direction.",
  labelNames: ["unit", "direction"] as const,
  registers: [registry],
});

export const scoutVoiceActivationStageLatencySeconds = new Histogram({
  name: "scout_voice_activation_stage_latency_seconds",
  help: "Latency of each wake activation stage in seconds.",
  labelNames: ["stage"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const scoutVoiceWakeToReplySeconds = new Histogram({
  name: "scout_voice_wake_to_reply_seconds",
  help: "Seconds from accepted wake to first assistant reply audio.",
  buckets: [0.5, 1, 2, 3, 5, 8, 13, 21],
  registers: [registry],
});

export const scoutVoiceOpenAiFailuresTotal = new Counter({
  name: "scout_voice_openai_failures_total",
  help: "OpenAI Realtime turn failures by stage.",
  labelNames: ["stage"] as const,
  registers: [registry],
});

export const scoutVoiceCloudRequestsTotal = new Counter({
  name: "scout_voice_cloud_requests_total",
  help: "OpenAI Realtime requests by stage and outcome.",
  labelNames: ["stage", "outcome"] as const,
  registers: [registry],
});

export const scoutVoiceConcurrentTurns = new Gauge({
  name: "scout_voice_concurrent_turns",
  help: "Realtime turns currently in flight.",
  registers: [registry],
});

export const scoutVoiceReplyPacketsTotal = new Counter({
  name: "scout_voice_reply_packets_total",
  help: "Assistant reply Opus packets sent.",
  registers: [registry],
});

export const scoutVoiceReplyBytesTotal = new Counter({
  name: "scout_voice_reply_bytes_total",
  help: "Assistant reply Opus bytes sent.",
  registers: [registry],
});

export const scoutVoiceReplySendFailuresTotal = new Counter({
  name: "scout_voice_reply_send_failures_total",
  help: "Assistant reply packets that failed to send.",
  registers: [registry],
});

export const scoutVoiceReplyDurationSeconds = new Histogram({
  name: "scout_voice_reply_duration_seconds",
  help: "Duration of assistant reply delivery by outcome.",
  labelNames: ["outcome"] as const,
  buckets: [0.5, 1, 2, 5, 10, 20, 30],
  registers: [registry],
});

export const scoutVoiceToolCallsTotal = new Counter({
  name: "scout_voice_tool_calls_total",
  help: "Voice League tool calls by tool and outcome.",
  labelNames: ["tool", "outcome"] as const,
  registers: [registry],
});

export const scoutVoiceActiveSessions = new Gauge({
  name: "scout_voice_active_sessions",
  help: "Voice assistant sessions currently listening in a channel.",
  registers: [registry],
});

export const scoutVoiceSessionsTotal = new Counter({
  name: "scout_voice_sessions_total",
  help: "Voice assistant session lifecycle events by reason.",
  labelNames: ["event", "reason"] as const,
  registers: [registry],
});
