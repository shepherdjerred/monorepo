import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import type { RealtimeTransportLayer } from "@openai/agents/realtime";
import { wakePcmToOpenAiPcm } from "@shepherdjerred/discord-video-stream";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  VOICE_ASSISTANT_VOICE,
  VOICE_REALTIME_MODEL,
} from "@shepherdjerred/streambot/voice/constants.ts";
import { type PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";
import {
  voiceAudioTokensTotal,
  voiceActivationStageLatencySeconds,
  voiceConcurrentTurns,
  voiceOpenAiFailuresTotal,
  voiceReplySendFailuresTotal,
  voiceTranscriptVerificationsTotal,
  voiceTurnsTotal,
  voiceWakeToReplySeconds,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import { voiceCloudRequestsTotal } from "@shepherdjerred/streambot/observability/voice-diagnostic-metrics.ts";
import {
  PacedAssistantSender,
  type AssistantAudioSink,
} from "@shepherdjerred/streambot/voice/assistant-sink.ts";
import type { SpokenFeedbackClips } from "@shepherdjerred/streambot/voice/spoken-feedback.ts";
import {
  NOOP_VOICE_ATTEMPT_OBSERVER,
  type VoiceAttemptHandle,
} from "@shepherdjerred/streambot/voice/attempt-context.ts";
import type { VoiceSessionTelemetry } from "@shepherdjerred/streambot/observability/voice-session.ts";

import {
  bindPlaybackVoiceCommandPort,
  createStreambotVoiceTools,
  type VoiceCommandPort,
  VoiceMutationGate,
} from "@shepherdjerred/streambot/voice/voice-tools.ts";
import { realtimeErrorToError } from "@shepherdjerred/streambot/voice/realtime-errors.ts";
import {
  ConversationItemCreatedEventSchema,
  ConversationItemDeletedEventSchema,
  normalizeTranscript,
  recordTranscriptionUsage,
  TranscriptionCompletedEventSchema,
  TranscriptionFailedEventSchema,
  verifyWakeTranscript,
  type CompletedTranscription,
} from "@shepherdjerred/streambot/voice/realtime-transcript.ts";

const INSTRUCTIONS = `You are Streambot, a voice-only media playback controller.
Handle exactly one concise playback request. You may only use the supplied Streambot tools.
Never answer general knowledge, browse, accept URLs, or invent media state.
For a clear request, call the single best tool and briefly speak its result.
Default play requests to source auto, which searches history, local files, and YouTube.
Treat “song by character” requests as likely AI covers; preserve the work and character in the query.
For “again”, “that song”, numbered choices, and similar references, use history or the pending search context.
When a title is uncertain, call search_media first. Read at most three choices and ask for first, second, or third.
Use placement queue unless the speaker explicitly says next or now.
Never call more than one mutating tool. Keep every spoken reply to one short sentence.`;

function audioTokenCount(details: readonly Record<string, number>[]): number {
  return details.reduce(
    (total, item) => total + (item["audio_tokens"] ?? 0),
    0,
  );
}

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

export type RealtimeCommandTurnResult = {
  readonly transcript: string | null;
  readonly wakeVerified: boolean;
  readonly mutated: boolean;
  readonly normalizedCommand: string | null;
  readonly clarificationRequested?: boolean;
};

export function buildRealtimeSessionConfig() {
  return {
    outputModalities: ["audio"] as const,
    parallelToolCalls: false,
    audio: {
      input: {
        format: { type: "audio/pcm" as const, rate: 24_000 },
        transcription: { model: "gpt-transcribe", language: "en" },
        turnDetection: null,
        noiseReduction: null,
      },
      output: {
        format: { type: "audio/pcm" as const, rate: 24_000 },
        voice: VOICE_ASSISTANT_VOICE,
      },
    },
  };
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const rejectAbort = () => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Voice transaction interrupted"),
      );
    };
    if (signal.aborted) {
      rejectAbort();
      return;
    }
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
}

function clarificationVersionOf(commands: VoiceCommandPort): number {
  return commands.clarificationVersion?.() ?? 0;
}

function clarificationWasRequested(
  commands: VoiceCommandPort,
  before: number,
): boolean {
  return clarificationVersionOf(commands) > before;
}

/** Shared fresh, audio-only Realtime WebSocket turn for production and local probes. */
export async function runRealtimeCommandTurn(
  config: Config["voice"],
  input: RealtimeCommandTurnInput,
): Promise<RealtimeCommandTurnResult> {
  if (config.openAiApiKey === undefined) {
    throw new Error("Voice assistant enabled without an OpenAI API key");
  }
  const apiKey = config.openAiApiKey;
  const mutationGate = new VoiceMutationGate();
  const clarificationVersion = clarificationVersionOf(input.commands);
  const attempt = input.attempt ?? NOOP_VOICE_ATTEMPT_OBSERVER.begin();
  const timeoutSignal = AbortSignal.timeout(config.transactionTimeoutMs);
  const transactionSignal =
    input.signal === undefined
      ? timeoutSignal
      : AbortSignal.any([input.signal, timeoutSignal]);
  const agent = new RealtimeAgent({
    name: "Streambot",
    instructions: INSTRUCTIONS,
    voice: VOICE_ASSISTANT_VOICE,
    tools: createStreambotVoiceTools(
      input.commands,
      mutationGate,
      transactionSignal,
      attempt,
    ),
  });
  const session = new RealtimeSession(agent, {
    apiKey,
    transport: input.createTransport?.() ?? "websocket",
    model: VOICE_REALTIME_MODEL,
    historyStoreAudio: false,
    tracingDisabled: true,
    config: buildRealtimeSessionConfig(),
  });
  let firstAudio = true;
  let failureStage = "connect";
  const transcription = new Promise<CompletedTranscription>(
    (resolve, reject) => {
      session.on("transport_event", (event) => {
        const completed = TranscriptionCompletedEventSchema.safeParse(event);
        if (completed.success) {
          resolve(completed.data);
          return;
        }
        const failed = TranscriptionFailedEventSchema.safeParse(event);
        if (failed.success) {
          reject(
            new Error("OpenAI input transcription failed", {
              cause: failed.data.error,
            }),
          );
        }
      });
    },
  );
  // A transcription failure can arrive while connect() is still being awaited, and this promise
  // only joins a race after that — across a macrotask gap, that rejection would surface as an
  // unhandled rejection. Observing it here closes the gap; the later race still receives the
  // original rejection, which is where it is actually handled.
  void (async () => {
    try {
      await transcription;
    } catch {
      // Deliberately observed-and-dropped: the turn's Promise.race is the real handler.
    }
  })();
  const completed = new Promise<void>((resolve) => {
    let observedToolCalls = 0;
    let completedToolCalls = 0;
    let resolved = false;

    // The transport reports the function call before the SDK starts executing it. Counting at
    // this boundary closes an SDK ordering race where `agent_end` for the tool-request response
    // can arrive before `agent_tool_start`/`agent_tool_end`.
    session.transport.on("function_call", () => {
      observedToolCalls += 1;
    });
    session.on("agent_tool_end", () => {
      completedToolCalls += 1;
    });
    session.on("audio", (event) => {
      if (firstAudio) {
        firstAudio = false;
        voiceWakeToReplySeconds.observe(
          (Date.now() - input.activatedAtMs) / 1000,
        );
      }
      input.assistantAudio.enqueue(new Uint8Array(event.data));
    });
    // An `agent_end` is response-scoped, not transaction-scoped. A response that asks for a tool
    // may end before the SDK finishes that tool; the tool output then starts the assistant's reply
    // response. Only the first agent_end at which every observed tool has completed is terminal.
    session.on("agent_end", () => {
      if (!resolved && completedToolCalls >= observedToolCalls) {
        resolved = true;
        resolve();
      }
    });
  });
  const sessionFailure = new Promise<never>((_resolve, reject) => {
    session.on("error", (event) => {
      reject(realtimeErrorToError(event.error));
    });
  });
  voiceConcurrentTurns.inc();
  try {
    const interruption = aborted(transactionSignal);
    voiceCloudRequestsTotal.inc({ stage: "connect", outcome: "request" });
    await attempt.runStage("streambot.voice.openai.connect", {}, async () => {
      await Promise.race([
        session.connect({
          apiKey,
          model: VOICE_REALTIME_MODEL,
        }),
        interruption,
        sessionFailure,
      ]);
    });
    voiceCloudRequestsTotal.inc({ stage: "connect", outcome: "success" });
    failureStage = "transcription";
    const pcm24k = wakePcmToOpenAiPcm(input.pcm16k);
    const transcriptionStartedAtMs = Date.now();
    // The SDK wants a bare ArrayBuffer and base64-encodes it synchronously inside sendAudio, so
    // both the source and the transmitted copy can be erased the moment the call returns.
    const pcm24kCopy = Uint8Array.from(pcm24k);
    try {
      session.sendAudio(pcm24kCopy.buffer, { commit: true });
    } finally {
      pcm24kCopy.fill(0);
      pcm24k.fill(0);
    }
    voiceCloudRequestsTotal.inc({
      stage: "transcription",
      outcome: "request",
    });
    const transcriptionResult = await attempt.runStage(
      "streambot.voice.openai.transcription",
      {},
      async () =>
        await Promise.race([transcription, interruption, sessionFailure]),
    );
    voiceCloudRequestsTotal.inc({
      stage: "transcription",
      outcome: "success",
    });
    voiceActivationStageLatencySeconds.observe(
      { stage: "cloud-transcription" },
      (Date.now() - transcriptionStartedAtMs) / 1000,
    );
    recordTranscriptionUsage(transcriptionResult.usage);
    attempt.cloudUsage({ transcription: transcriptionResult.usage });
    const verified =
      input.wakeRequired === false
        ? {
            normalized: normalizeTranscript(transcriptionResult.transcript),
            command: normalizeTranscript(transcriptionResult.transcript),
          }
        : verifyWakeTranscript(transcriptionResult.transcript);
    if (verified === null) {
      attempt.transcription({
        transcript: transcriptionResult.transcript,
        normalizedCommand: null,
        outcome: "rejected",
      });
      attempt.cloudOutcome("transcript-rejected");
      voiceTranscriptVerificationsTotal.inc({ outcome: "rejected" });
      voiceTurnsTotal.inc({ outcome: "transcript-rejected" });
      // Still response.create-free: the retry line is a local pre-rendered clip, so nothing
      // about the rejected audio reaches the Realtime model — but the speaker is no longer
      // left wondering whether Streambot heard anything at all.
      if (input.feedbackClips === undefined) {
        await input.assistantAudio.cancel();
      } else {
        input.assistantAudio.enqueue(input.feedbackClips.retry);
        await Promise.race([input.assistantAudio.finish(), interruption]);
      }
      return {
        transcript: transcriptionResult.transcript,
        wakeVerified: false,
        mutated: false,
        normalizedCommand: null,
        clarificationRequested: false,
      };
    }
    attempt.transcription({
      transcript: transcriptionResult.transcript,
      normalizedCommand: verified.command,
      outcome: "accepted",
    });
    voiceTranscriptVerificationsTotal.inc({ outcome: "accepted" });
    if (verified.command.length === 0) {
      // A bare "Hey Streambot" used to bill a full Realtime response just to ask what to play.
      // The prompt is a local clip instead; no conversation item is created and no response is
      // requested, and the finally below closes the session immediately.
      voiceTurnsTotal.inc({ outcome: "bare-wake" });
      if (input.feedbackClips === undefined) {
        await input.assistantAudio.cancel();
      } else {
        input.assistantAudio.enqueue(input.feedbackClips.prompt);
        await Promise.race([input.assistantAudio.finish(), interruption]);
      }
      return {
        transcript: transcriptionResult.transcript,
        wakeVerified: true,
        mutated: false,
        normalizedCommand: "",
        clarificationRequested: false,
      };
    }
    failureStage = "verified-command";

    const deleted = new Promise<void>((resolve) => {
      session.on("transport_event", (event) => {
        const parsed = ConversationItemDeletedEventSchema.safeParse(event);
        if (
          parsed.success &&
          parsed.data.item_id === transcriptionResult.item_id
        ) {
          resolve();
        }
      });
    });
    session.transport.sendEvent({
      type: "conversation.item.delete",
      item_id: transcriptionResult.item_id,
    });
    await Promise.race([deleted, interruption, sessionFailure]);

    // The Realtime API rejects a conversation item.id longer than 32 chars
    // (`string_above_max_length`). "verified-command-" + a 36-char UUID was 53,
    // so every command insertion failed and no turn ever produced a command.
    // A dash-stripped UUID slice keeps it unique and well under the cap.
    const verifiedCommandItemId = `vc-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
    const created = new Promise<void>((resolve) => {
      session.on("transport_event", (event) => {
        const parsed = ConversationItemCreatedEventSchema.safeParse(event);
        if (parsed.success && parsed.data.item.id === verifiedCommandItemId) {
          resolve();
        }
      });
    });
    session.transport.sendEvent({
      type: "conversation.item.create",
      item: {
        id: verifiedCommandItemId,
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: verified.command }],
      },
    });
    await Promise.race([created, interruption, sessionFailure]);
    failureStage = "response";
    voiceCloudRequestsTotal.inc({ stage: "response", outcome: "request" });
    await attempt.runStage(
      "streambot.voice.openai.response",
      { "streambot.voice.normalized_command": verified.command },
      async () => {
        session.transport.sendEvent({ type: "response.create" });
        await Promise.race([completed, interruption, sessionFailure]);
      },
    );
    voiceCloudRequestsTotal.inc({ stage: "response", outcome: "success" });
    // `audio_stopped` only means Realtime finished generating. The sink still paces whatever it
    // queued at 20 ms per packet, so leaving this await unraced lets a long or fast-generated
    // reply drain past the transaction timeout — holding the duck down, the teardown hold open,
    // and the lifecycle's input gate shut. On expiry the catch below cancels the sink, which
    // truncates the queue and lets this drain settle within one packet.
    await Promise.race([input.assistantAudio.finish(), interruption]);
    const inputAudio = audioTokenCount(session.usage.inputTokensDetails);
    const outputAudio = audioTokenCount(session.usage.outputTokensDetails);
    if (inputAudio > 0)
      voiceAudioTokensTotal.inc({ direction: "input" }, inputAudio);
    if (outputAudio > 0)
      voiceAudioTokensTotal.inc({ direction: "output" }, outputAudio);
    attempt.cloudUsage({
      transcription: transcriptionResult.usage,
      realtime: {
        inputAudioTokens: inputAudio,
        outputAudioTokens: outputAudio,
      },
    });
    voiceTurnsTotal.inc({
      outcome: mutationGate.hasMutated ? "command" : "no-command",
    });
    attempt.cloudOutcome("success");
    return {
      transcript: transcriptionResult.transcript,
      wakeVerified: true,
      mutated: mutationGate.hasMutated,
      normalizedCommand: verified.command,
      clarificationRequested: clarificationWasRequested(
        input.commands,
        clarificationVersion,
      ),
    };
  } catch (error) {
    if (input.signal?.aborted === true) {
      voiceTurnsTotal.inc({ outcome: "interrupted" });
    } else {
      voiceOpenAiFailuresTotal.inc({ stage: failureStage });
      voiceCloudRequestsTotal.inc({ stage: failureStage, outcome: "failure" });
      voiceTurnsTotal.inc({ outcome: "error" });
    }
    try {
      await input.assistantAudio.cancel();
    } catch {
      // Cancellation is cleanup. If it fails we still owe the caller the
      // reason we got here, so never let it replace `error`.
      voiceReplySendFailuresTotal.inc();
    }
    throw error;
  } finally {
    session.close();
    voiceConcurrentTurns.dec();
  }
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
      ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
      ...(input.telemetry === undefined ? {} : { telemetry: input.telemetry }),
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
