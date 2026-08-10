import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import type { RealtimeTransportLayer } from "@openai/agents/realtime";
import { z } from "zod";
import {
  DiscordOpusEncoder,
  wakePcmToOpenAiPcm,
} from "@shepherdjerred/discord-video-stream";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { type PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";
import {
  voiceAudioTokensTotal,
  voiceActivationStageLatencySeconds,
  voiceConcurrentTurns,
  voiceOpenAiFailuresTotal,
  voiceReplyPacketsTotal,
  voiceTranscriptVerificationsTotal,
  voiceTranscriptionUsageTotal,
  voiceTurnsTotal,
  voiceWakeToReplySeconds,
} from "@shepherdjerred/streambot/observability/metrics.ts";
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

const EMPTY_VERIFIED_COMMAND = "[no command after verified wake phrase]";

export type AssistantAudioSink = {
  readonly enqueue: (pcm24k: Uint8Array) => void;
  readonly finish: () => Promise<void>;
  readonly cancel: () => Promise<void>;
};

function audioTokenCount(details: readonly Record<string, number>[]): number {
  return details.reduce(
    (total, item) => total + (item["audio_tokens"] ?? 0),
    0,
  );
}

class PacedAssistantSender implements AssistantAudioSink {
  private readonly encoder = new DiscordOpusEncoder();
  private readonly queue: Uint8Array[] = [];
  private task: Promise<void> | null = null;
  private finishTask: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private done = false;
  private cancelled = false;

  constructor(private readonly streamer: StreamerLike) {}

  enqueue(pcm24k: Uint8Array): void {
    if (this.cancelled) return;
    this.queue.push(...this.encoder.encode(pcm24k));
    this.start();
    this.wake?.();
    this.wake = null;
  }

  finish(): Promise<void> {
    this.finishTask ??= this.complete(true);
    return this.finishTask;
  }

  cancel(): Promise<void> {
    this.cancelled = true;
    this.queue.length = 0;
    if (this.task === null) {
      this.done = true;
      this.encoder.close();
      this.finishTask ??= Promise.resolve();
      return this.finishTask;
    }
    this.finishTask ??= this.complete(false);
    this.done = true;
    this.wake?.();
    this.wake = null;
    return this.finishTask;
  }

  private async complete(flush: boolean): Promise<void> {
    try {
      if (flush && !this.cancelled) this.queue.push(...this.encoder.finish());
      this.done = true;
      this.start();
      this.wake?.();
      this.wake = null;
      await this.task;
    } finally {
      this.encoder.close();
      await this.streamer.setAssistantSpeaking(false);
    }
  }

  private start(): void {
    this.task ??= this.run();
  }

  private async run(): Promise<void> {
    await this.streamer.setAssistantSpeaking(true);
    while (!this.done || this.queue.length > 0) {
      const packet = this.queue.shift();
      if (packet === undefined) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        continue;
      }
      this.streamer.sendAssistantOpus(packet);
      voiceReplyPacketsTotal.inc();
      await Bun.sleep(20);
    }
  }
}

export type RealtimeVoiceTurnInput = {
  readonly pcm16k: Float32Array;
  readonly activatedAtMs: number;
  readonly userId: UserId;
  readonly service: PlaybackCommandService;
  readonly streamer: StreamerLike;
  readonly signal?: AbortSignal;
  /** Test seam; production omits this and gets the official server WebSocket transport. */
  readonly createTransport?: () => RealtimeTransportLayer;
};

export type RealtimeCommandTurnInput = {
  readonly pcm16k: Float32Array;
  readonly activatedAtMs: number;
  readonly commands: VoiceCommandPort;
  readonly assistantAudio: AssistantAudioSink;
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
    try {
      session.sendAudio(Uint8Array.from(pcm24k).buffer, { commit: true });
    } finally {
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
      return {
        transcript: transcriptionResult.transcript,
        wakeVerified: false,
        mutated: false,
      };
    }
    voiceTranscriptVerificationsTotal.inc({ outcome: "accepted" });
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
        content: [
          {
            type: "input_text",
            text:
              verified.command.length === 0
                ? EMPTY_VERIFIED_COMMAND
                : verified.command,
          },
        ],
      },
    });
    await Promise.race([created, interruption, sessionFailure]);
    failureStage = "response";
    session.transport.sendEvent({ type: "response.create" });
    await Promise.race([completed, interruption, sessionFailure]);
    await input.assistantAudio.finish();
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
    await input.assistantAudio.cancel();
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
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.createTransport === undefined
      ? {}
      : { createTransport: input.createTransport }),
  });
}
