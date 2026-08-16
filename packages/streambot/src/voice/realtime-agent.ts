import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import type { RealtimeTransportLayer } from "@openai/agents/realtime";
import { z } from "zod";
import { wakePcmToOpenAiPcm } from "@shepherdjerred/discord-video-stream";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
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
  voiceTranscriptionUsageTotal,
  voiceTurnsTotal,
  voiceWakeToReplySeconds,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import {
  PacedAssistantSender,
  type AssistantAudioSink,
} from "@shepherdjerred/streambot/voice/assistant-sink.ts";
import type { SpokenFeedbackClips } from "@shepherdjerred/streambot/voice/spoken-feedback.ts";

import {
  bindPlaybackVoiceCommandPort,
  createStreambotVoiceTools,
  type VoiceCommandPort,
  VoiceMutationGate,
} from "@shepherdjerred/streambot/voice/voice-tools.ts";

const INSTRUCTIONS = `You are Streambot, a voice-only media playback controller.
Handle exactly one concise playback request. You may only use the supplied Streambot tools.
Never answer general knowledge, browse, accept URLs, or invent media state.
For a clear request, call the single best tool and briefly speak its result.
If the request is ambiguous, ask the speaker to try again more specifically and execute nothing.
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
};

export type RealtimeCommandTurnResult = {
  readonly transcript: string | null;
  readonly wakeVerified: boolean;
  readonly mutated: boolean;
};

const TranscriptionCompletedEventSchema = z.object({
  type: z.literal("conversation.item.input_audio_transcription.completed"),
  item_id: z.string().min(1),
  transcript: z.string(),
  usage: z.union([
    z.object({
      type: z.literal("tokens"),
      input_tokens: z.number().nonnegative(),
      output_tokens: z.number().nonnegative(),
      total_tokens: z.number().nonnegative(),
      input_token_details: z
        .object({
          audio_tokens: z.number().nonnegative().optional(),
          text_tokens: z.number().nonnegative().optional(),
        })
        .optional(),
    }),
    z.object({
      type: z.literal("duration"),
      seconds: z.number().nonnegative(),
    }),
  ]),
});

const TranscriptionFailedEventSchema = z.object({
  type: z.literal("conversation.item.input_audio_transcription.failed"),
  error: z.unknown().optional(),
});

const ConversationItemDeletedEventSchema = z.object({
  type: z.literal("conversation.item.deleted"),
  item_id: z.string().min(1),
});

const ConversationItemCreatedEventSchema = z.object({
  type: z.literal("conversation.item.created"),
  item: z.object({ id: z.string().min(1) }),
});

export function buildRealtimeSessionConfig(config: Config["voice"]) {
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
        voice: config.assistantVoice,
      },
    },
  };
}

export type VerifiedWakeTranscript = {
  readonly normalized: string;
  readonly command: string;
};

/** Strict final wake gate. The phrase must be the leading normalized words. */
export function verifyWakeTranscript(
  transcript: string,
): VerifiedWakeTranscript | null {
  const normalized = transcript
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9\s]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  for (const prefix of ["hey streambot", "hey stream bot", "hey streamboat"]) {
    if (normalized === prefix) return { normalized, command: "" };
    if (normalized.startsWith(`${prefix} `)) {
      return { normalized, command: normalized.slice(prefix.length + 1) };
    }
  }
  return null;
}

type CompletedTranscription = z.infer<typeof TranscriptionCompletedEventSchema>;

function recordTranscriptionUsage(
  usage: CompletedTranscription["usage"],
): void {
  if (usage.type === "duration") {
    voiceTranscriptionUsageTotal.inc(
      { unit: "seconds", direction: "input" },
      usage.seconds,
    );
    return;
  }
  voiceTranscriptionUsageTotal.inc(
    { unit: "tokens", direction: "input" },
    usage.input_tokens,
  );
  voiceTranscriptionUsageTotal.inc(
    { unit: "tokens", direction: "output" },
    usage.output_tokens,
  );
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

/** Shared fresh, audio-only Realtime WebSocket turn for production and local probes. */
export async function runRealtimeCommandTurn(
  config: Config["voice"],
  input: RealtimeCommandTurnInput,
): Promise<RealtimeCommandTurnResult> {
  if (config.openAiApiKey === undefined) {
    throw new Error("Voice assistant enabled without an OpenAI API key");
  }
  const mutationGate = new VoiceMutationGate();
  const timeoutSignal = AbortSignal.timeout(config.transactionTimeoutMs);
  const transactionSignal =
    input.signal === undefined
      ? timeoutSignal
      : AbortSignal.any([input.signal, timeoutSignal]);
  const agent = new RealtimeAgent({
    name: "Streambot",
    instructions: INSTRUCTIONS,
    voice: config.assistantVoice,
    tools: createStreambotVoiceTools(
      input.commands,
      mutationGate,
      transactionSignal,
    ),
  });
  const session = new RealtimeSession(agent, {
    apiKey: config.openAiApiKey,
    transport: input.createTransport?.() ?? "websocket",
    model: config.model,
    historyStoreAudio: false,
    tracingDisabled: true,
    config: buildRealtimeSessionConfig(config),
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
    session.on("audio", (event) => {
      if (firstAudio) {
        firstAudio = false;
        voiceWakeToReplySeconds.observe(
          (Date.now() - input.activatedAtMs) / 1000,
        );
      }
      input.assistantAudio.enqueue(new Uint8Array(event.data));
    });
    session.on("audio_stopped", () => {
      resolve();
    });
  });
  const sessionFailure = new Promise<never>((_resolve, reject) => {
    session.on("error", (event) => {
      reject(
        event.error instanceof Error
          ? event.error
          : new Error(String(event.error)),
      );
    });
  });
  voiceConcurrentTurns.inc();
  try {
    const interruption = aborted(transactionSignal);
    await Promise.race([
      session.connect({ apiKey: config.openAiApiKey, model: config.model }),
      interruption,
      sessionFailure,
    ]);
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
    const transcriptionResult = await Promise.race([
      transcription,
      interruption,
      sessionFailure,
    ]);
    voiceActivationStageLatencySeconds.observe(
      { stage: "cloud-transcription" },
      (Date.now() - transcriptionStartedAtMs) / 1000,
    );
    recordTranscriptionUsage(transcriptionResult.usage);
    const verified = verifyWakeTranscript(transcriptionResult.transcript);
    if (verified === null) {
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
      };
    }
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

    const verifiedCommandItemId = `verified-command-${crypto.randomUUID()}`;
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
    session.transport.sendEvent({ type: "response.create" });
    await Promise.race([completed, interruption, sessionFailure]);
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
    voiceTurnsTotal.inc({
      outcome: mutationGate.hasMutated ? "command" : "no-command",
    });
    return {
      transcript: transcriptionResult.transcript,
      wakeVerified: true,
      mutated: mutationGate.hasMutated,
    };
  } catch (error) {
    if (input.signal?.aborted === true) {
      voiceTurnsTotal.inc({ outcome: "interrupted" });
    } else {
      voiceOpenAiFailuresTotal.inc({ stage: failureStage });
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
    assistantAudio: new PacedAssistantSender(input.streamer),
    ...(input.feedbackClips === undefined
      ? {}
      : { feedbackClips: input.feedbackClips }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.createTransport === undefined
      ? {}
      : { createTransport: input.createTransport }),
  });
}
