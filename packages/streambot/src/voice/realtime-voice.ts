import type { RealtimeTransportLayer } from "@openai/agents/realtime";
import {
  buildRealtimeSessionConfig as buildVoiceAssistantSessionConfig,
  runRealtimeCommandTurn as runVoiceAssistantCommandTurn,
  verifyWakeTranscript as verifyVoiceAssistantWakeTranscript,
  PacedAssistantSender,
  type AssistantAudioSink,
  type RealtimeCommandTurnResult,
  type RealtimeTurnOptions,
  type SpokenFeedbackClips,
  type VerifiedWakeTranscript,
} from "@shepherdjerred/voice-assistant";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  VOICE_ASSISTANT_VOICE,
  VOICE_INSTRUCTIONS,
  VOICE_REALTIME_MODEL,
  VOICE_WAKE_PREFIXES,
} from "@shepherdjerred/streambot/voice/constants.ts";
import { type PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";
import {
  STREAMBOT_VOICE_STAGE_PREFIX,
  streambotRealtimeTurnMetrics,
  streambotVoiceObservability,
  streambotVoiceReplyMetrics,
} from "@shepherdjerred/streambot/observability/voice-metrics-ports.ts";
import type { VoiceAttemptHandle } from "@shepherdjerred/voice-assistant/attempt.ts";
import type { VoiceSessionTelemetry } from "@shepherdjerred/streambot/observability/voice-session.ts";
import {
  bindPlaybackVoiceCommandPort,
  createStreambotVoiceTools,
  type VoiceCommandPort,
} from "@shepherdjerred/streambot/voice/voice-tools.ts";

/**
 * Streambot's production binding of the shared Realtime command turn: the hey-streambot wake
 * prefixes, playback instructions and tools, pinned model/voice identifiers, and the existing
 * prom-client metric and span-prefix ports. The turn mechanics live in
 * `@shepherdjerred/voice-assistant`.
 */

export type RealtimeVoiceTurnInput = {
  readonly pcm16k: Float32Array;
  readonly activatedAtMs: number;
  readonly userId: UserId;
  readonly service: PlaybackCommandService;
  readonly streamer: StreamerLike;
  /** Local pre-rendered feedback; when absent, rejected and bare wakes stay silent (probes/tests). */
  readonly feedbackClips?: SpokenFeedbackClips;
  readonly signal?: AbortSignal;
  /** Test seam; production omits this and gets the official server WebSocket transport. */
  readonly createTransport?: () => RealtimeTransportLayer;
  readonly attempt?: VoiceAttemptHandle;
  readonly telemetry?: VoiceSessionTelemetry;
  readonly wakeRequired?: boolean;
};

export type RealtimeCommandTurnInput = {
  readonly pcm16k: Float32Array;
  readonly activatedAtMs: number;
  readonly commands: VoiceCommandPort;
  readonly assistantAudio: AssistantAudioSink;
  /** Local pre-rendered feedback; when absent, rejected and bare wakes stay silent (probes/tests). */
  readonly feedbackClips?: SpokenFeedbackClips;
  readonly signal?: AbortSignal;
  /** Test seam; production omits this and gets the official server WebSocket transport. */
  readonly createTransport?: () => RealtimeTransportLayer;
  /** No-op in local probes/corpus evaluation. */
  readonly attempt?: VoiceAttemptHandle;
  readonly wakeRequired?: boolean;
};

function clarificationVersionOf(commands: VoiceCommandPort): number {
  return commands.clarificationVersion?.() ?? 0;
}

/** The streambot-specific turn options for one wake, bound to a user/session command port. */
export function streambotRealtimeTurnOptions(
  config: Config["voice"],
  commands: VoiceCommandPort,
): RealtimeTurnOptions {
  return {
    apiKey: config.openAiApiKey,
    model: VOICE_REALTIME_MODEL,
    assistantVoice: VOICE_ASSISTANT_VOICE,
    agentName: "Streambot",
    instructions: VOICE_INSTRUCTIONS,
    transactionTimeoutMs: config.transactionTimeoutMs,
    wakePrefixes: VOICE_WAKE_PREFIXES,
    tools: ({ mutationGate, signal, attempt }) =>
      createStreambotVoiceTools(commands, mutationGate, signal, attempt),
    metrics: streambotRealtimeTurnMetrics,
    observability: streambotVoiceObservability("voice-realtime"),
  };
}

export function buildRealtimeSessionConfig() {
  return buildVoiceAssistantSessionConfig({
    assistantVoice: VOICE_ASSISTANT_VOICE,
  });
}

/** Strict final wake gate against streambot's normalized wake-prefix variants. */
export function verifyWakeTranscript(
  transcript: string,
): VerifiedWakeTranscript | null {
  return verifyVoiceAssistantWakeTranscript(transcript, VOICE_WAKE_PREFIXES);
}

/**
 * Shared fresh, audio-only Realtime WebSocket turn for production and local probes.
 *
 * `clarificationRequested` is streambot-specific (the shared package has no concept of it): a
 * clarification tool bumps `commands.clarificationVersion()`, and this wrapper snapshots that
 * counter before and after the turn to detect whether one fired, augmenting the package's result.
 */
export async function runRealtimeCommandTurn(
  config: Config["voice"],
  input: RealtimeCommandTurnInput,
): Promise<RealtimeCommandTurnResult> {
  const clarificationVersion = clarificationVersionOf(input.commands);
  const result = await runVoiceAssistantCommandTurn(
    streambotRealtimeTurnOptions(config, input.commands),
    {
      pcm16k: input.pcm16k,
      activatedAtMs: input.activatedAtMs,
      assistantAudio: input.assistantAudio,
      ...(input.feedbackClips === undefined
        ? {}
        : { feedbackClips: input.feedbackClips }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.createTransport === undefined
        ? {}
        : { createTransport: input.createTransport }),
      ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
      ...(input.wakeRequired === undefined
        ? {}
        : { wakeRequired: input.wakeRequired }),
    },
  );
  return {
    ...result,
    clarificationRequested:
      clarificationVersionOf(input.commands) > clarificationVersion,
  };
}

/** Production wrapper: trusted Discord user binding plus paced normal-voice reply audio. */
export async function runRealtimeVoiceTurn(
  config: Config["voice"],
  input: RealtimeVoiceTurnInput,
): Promise<RealtimeCommandTurnResult> {
  return await runRealtimeCommandTurn(config, {
    pcm16k: input.pcm16k,
    activatedAtMs: input.activatedAtMs,
    commands: bindPlaybackVoiceCommandPort(input.service, input.userId),
    assistantAudio: new PacedAssistantSender(input.streamer, {
      stagePrefix: STREAMBOT_VOICE_STAGE_PREFIX,
      metrics: streambotVoiceReplyMetrics,
      ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
      ...(input.telemetry === undefined ? {} : { duck: input.telemetry }),
    }),
    ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
    ...(input.feedbackClips === undefined
      ? {}
      : { feedbackClips: input.feedbackClips }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.createTransport === undefined
      ? {}
      : { createTransport: input.createTransport }),
    ...(input.wakeRequired === undefined
      ? {}
      : { wakeRequired: input.wakeRequired }),
  });
}

/** Speak one local clip over normal voice with the standard paced sender and duck handling. */
export async function speakClip(
  streamer: StreamerLike,
  clip: Uint8Array,
): Promise<void> {
  const sender = new PacedAssistantSender(streamer, {
    stagePrefix: STREAMBOT_VOICE_STAGE_PREFIX,
    metrics: streambotVoiceReplyMetrics,
  });
  sender.enqueue(clip);
  await sender.finish();
}
