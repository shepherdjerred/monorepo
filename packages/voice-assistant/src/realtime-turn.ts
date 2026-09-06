import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import type {
  RealtimeAgentConfiguration,
  RealtimeTransportLayer,
} from "@openai/agents/realtime";
import { z } from "zod";
import { wakePcmToOpenAiPcm } from "./codecs.ts";
import type { AssistantAudioSink } from "./assistant-sink.ts";
import type { SpokenFeedbackClips } from "./spoken-feedback.ts";
import {
  NOOP_VOICE_ATTEMPT_OBSERVER,
  type VoiceAttemptHandle,
} from "./attempt.ts";
import { VoiceMutationGate } from "./mutation-gate.ts";
import type { RealtimeTurnMetrics, VoiceObservability } from "./ports.ts";
import { realtimeErrorToError } from "./realtime-errors.ts";

export type RealtimeTurnTools = NonNullable<
  RealtimeAgentConfiguration["tools"]
>;

export type RealtimeTurnToolContext = {
  readonly mutationGate: VoiceMutationGate;
  readonly signal: AbortSignal;
  readonly attempt: VoiceAttemptHandle;
};

/**
 * Everything phrase-, product-, and account-specific about one Realtime command turn.
 * The turn mechanics (privacy invariants, abort/timeout races, response.create-free rejected
 * and bare-wake paths) live in {@link runRealtimeCommandTurn} and never vary per consumer.
 */
export type RealtimeTurnOptions = {
  readonly apiKey: string | undefined;
  readonly model: string;
  readonly assistantVoice: string;
  readonly agentName: string;
  readonly instructions: string;
  /** Input transcription model; defaults to "gpt-transcribe". */
  readonly transcriptionModel?: string;
  readonly transactionTimeoutMs: number;
  /** Normalized leading wake prefixes accepted by the strict transcript gate. */
  readonly wakePrefixes: readonly string[];
  readonly tools: (context: RealtimeTurnToolContext) => RealtimeTurnTools;
  readonly metrics: RealtimeTurnMetrics;
  readonly observability: VoiceObservability;
};

export type RealtimeCommandTurnInput = {
  readonly pcm16k: Float32Array;
  readonly activatedAtMs: number;
  readonly assistantAudio: AssistantAudioSink;
  /** Local pre-rendered feedback; when absent, rejected and bare wakes stay silent (probes/tests). */
  readonly feedbackClips?: SpokenFeedbackClips;
  readonly signal?: AbortSignal;
  /** Test seam; production omits this and gets the official server WebSocket transport. */
  readonly createTransport?: () => RealtimeTransportLayer;
  /** No-op in local probes/corpus evaluation. */
  readonly attempt?: VoiceAttemptHandle;
  /**
   * Skip the leading wake-prefix gate and treat the whole normalized transcript as the command
   * (e.g. a follow-up turn already scoped by the caller). Defaults to true.
   */
  readonly wakeRequired?: boolean;
};

export type RealtimeCommandTurnResult = {
  readonly transcript: string | null;
  readonly wakeVerified: boolean;
  readonly mutated: boolean;
  readonly normalizedCommand: string | null;
  /**
   * Left unset by this package — it has no concept of "clarification". A consumer whose tools
   * can ask a clarifying question computes this itself (see streambot's `realtime-voice.ts`)
   * and augments the result before returning it to its own callers.
   */
  readonly clarificationRequested?: boolean;
};

function audioTokenCount(details: readonly Record<string, number>[]): number {
  return details.reduce(
    (total, item) => total + (item["audio_tokens"] ?? 0),
    0,
  );
}

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

// The Realtime GA API renamed this event from "conversation.item.created" to
// "conversation.item.added"; the SDK forwards the raw name. Matching only the old
// name left the command-item wait hanging until the transaction timeout, so no
// command ever ran. Accept both so the turn works across API revisions.
const ConversationItemCreatedEventSchema = z.object({
  type: z.enum(["conversation.item.added", "conversation.item.created"]),
  item: z.object({ id: z.string().min(1) }),
});

export function buildRealtimeSessionConfig(options: {
  readonly assistantVoice: string;
  readonly transcriptionModel?: string;
}) {
  return {
    outputModalities: ["audio"] as const,
    parallelToolCalls: false,
    audio: {
      input: {
        format: { type: "audio/pcm" as const, rate: 24_000 },
        transcription: {
          model: options.transcriptionModel ?? "gpt-transcribe",
          language: "en",
        },
        turnDetection: null,
        noiseReduction: null,
      },
      output: {
        format: { type: "audio/pcm" as const, rate: 24_000 },
        voice: options.assistantVoice,
      },
    },
  };
}

export type VerifiedWakeTranscript = {
  readonly normalized: string;
  readonly command: string;
};

export function normalizeTranscript(transcript: string): string {
  return transcript
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^a-z0-9\s]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** Strict final wake gate. A configured phrase must be the leading normalized words. */
export function verifyWakeTranscript(
  transcript: string,
  wakePrefixes: readonly string[],
): VerifiedWakeTranscript | null {
  const normalized = normalizeTranscript(transcript);
  for (const prefix of wakePrefixes) {
    if (normalized === prefix) return { normalized, command: "" };
    if (normalized.startsWith(`${prefix} `)) {
      return { normalized, command: normalized.slice(prefix.length + 1) };
    }
  }
  return null;
}

type CompletedTranscription = z.infer<typeof TranscriptionCompletedEventSchema>;

function recordTranscriptionUsage(
  metrics: RealtimeTurnMetrics,
  usage: CompletedTranscription["usage"],
): void {
  if (usage.type === "duration") {
    metrics.transcriptionUsage.inc(
      { unit: "seconds", direction: "input" },
      usage.seconds,
    );
    return;
  }
  metrics.transcriptionUsage.inc(
    { unit: "tokens", direction: "input" },
    usage.input_tokens,
  );
  metrics.transcriptionUsage.inc(
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

/** One fresh, audio-only Realtime WebSocket turn, shared by production sessions and local probes. */
export async function runRealtimeCommandTurn(
  options: RealtimeTurnOptions,
  input: RealtimeCommandTurnInput,
): Promise<RealtimeCommandTurnResult> {
  if (options.apiKey === undefined) {
    throw new Error("Voice assistant enabled without an OpenAI API key");
  }
  const apiKey = options.apiKey;
  const { metrics } = options;
  const { stagePrefix } = options.observability;
  const mutationGate = new VoiceMutationGate();
  const attempt = input.attempt ?? NOOP_VOICE_ATTEMPT_OBSERVER.begin();
  const timeoutSignal = AbortSignal.timeout(options.transactionTimeoutMs);
  const transactionSignal =
    input.signal === undefined
      ? timeoutSignal
      : AbortSignal.any([input.signal, timeoutSignal]);
  const agent = new RealtimeAgent({
    name: options.agentName,
    instructions: options.instructions,
    voice: options.assistantVoice,
    tools: options.tools({
      mutationGate,
      signal: transactionSignal,
      attempt,
    }),
  });
  const session = new RealtimeSession(agent, {
    apiKey,
    transport: input.createTransport?.() ?? "websocket",
    model: options.model,
    historyStoreAudio: false,
    tracingDisabled: true,
    config: buildRealtimeSessionConfig({
      assistantVoice: options.assistantVoice,
      ...(options.transcriptionModel === undefined
        ? {}
        : { transcriptionModel: options.transcriptionModel }),
    }),
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
        metrics.wakeToReplySeconds.observe(
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
  metrics.concurrentTurns.inc();
  try {
    const interruption = aborted(transactionSignal);
    metrics.cloudRequests.inc({ stage: "connect", outcome: "request" });
    await attempt.runStage(`${stagePrefix}.openai.connect`, {}, async () => {
      await Promise.race([
        session.connect({
          apiKey,
          model: options.model,
        }),
        interruption,
        sessionFailure,
      ]);
    });
    metrics.cloudRequests.inc({ stage: "connect", outcome: "success" });
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
    metrics.cloudRequests.inc({
      stage: "transcription",
      outcome: "request",
    });
    const transcriptionResult = await attempt.runStage(
      `${stagePrefix}.openai.transcription`,
      {},
      async () =>
        await Promise.race([transcription, interruption, sessionFailure]),
    );
    metrics.cloudRequests.inc({
      stage: "transcription",
      outcome: "success",
    });
    metrics.activationStageLatencySeconds.observe(
      { stage: "cloud-transcription" },
      (Date.now() - transcriptionStartedAtMs) / 1000,
    );
    recordTranscriptionUsage(metrics, transcriptionResult.usage);
    attempt.cloudUsage({ transcription: transcriptionResult.usage });
    const verified =
      input.wakeRequired === false
        ? {
            normalized: normalizeTranscript(transcriptionResult.transcript),
            command: normalizeTranscript(transcriptionResult.transcript),
          }
        : verifyWakeTranscript(
            transcriptionResult.transcript,
            options.wakePrefixes,
          );
    if (verified === null) {
      attempt.transcription({
        transcript: transcriptionResult.transcript,
        normalizedCommand: null,
        outcome: "rejected",
      });
      attempt.cloudOutcome("transcript-rejected");
      metrics.transcriptVerifications.inc({ outcome: "rejected" });
      metrics.turns.inc({ outcome: "transcript-rejected" });
      // Still response.create-free: the retry line is a local pre-rendered clip, so nothing
      // about the rejected audio reaches the Realtime model — but the speaker is no longer
      // left wondering whether the assistant heard anything at all.
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
      };
    }
    attempt.transcription({
      transcript: transcriptionResult.transcript,
      normalizedCommand: verified.command,
      outcome: "accepted",
    });
    metrics.transcriptVerifications.inc({ outcome: "accepted" });
    if (verified.command.length === 0) {
      // A bare wake phrase used to bill a full Realtime response just to ask what to do.
      // The prompt is a local clip instead; no conversation item is created and no response is
      // requested, and the finally below closes the session immediately.
      metrics.turns.inc({ outcome: "bare-wake" });
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
    metrics.cloudRequests.inc({ stage: "response", outcome: "request" });
    await attempt.runStage(
      `${stagePrefix}.openai.response`,
      { [`${stagePrefix}.normalized_command`]: verified.command },
      async () => {
        session.transport.sendEvent({ type: "response.create" });
        await Promise.race([completed, interruption, sessionFailure]);
      },
    );
    metrics.cloudRequests.inc({ stage: "response", outcome: "success" });
    // `audio_stopped` only means Realtime finished generating. The sink still paces whatever it
    // queued at 20 ms per packet, so leaving this await unraced lets a long or fast-generated
    // reply drain past the transaction timeout — holding the duck down, the teardown hold open,
    // and the lifecycle's input gate shut. On expiry the catch below cancels the sink, which
    // truncates the queue and lets this drain settle within one packet.
    await Promise.race([input.assistantAudio.finish(), interruption]);
    const inputAudio = audioTokenCount(session.usage.inputTokensDetails);
    const outputAudio = audioTokenCount(session.usage.outputTokensDetails);
    if (inputAudio > 0)
      metrics.audioTokens.inc({ direction: "input" }, inputAudio);
    if (outputAudio > 0)
      metrics.audioTokens.inc({ direction: "output" }, outputAudio);
    attempt.cloudUsage({
      transcription: transcriptionResult.usage,
      realtime: {
        inputAudioTokens: inputAudio,
        outputAudioTokens: outputAudio,
      },
    });
    metrics.turns.inc({
      outcome: mutationGate.hasMutated ? "command" : "no-command",
    });
    attempt.cloudOutcome("success");
    return {
      transcript: transcriptionResult.transcript,
      wakeVerified: true,
      mutated: mutationGate.hasMutated,
      normalizedCommand: verified.command,
    };
  } catch (error) {
    if (input.signal?.aborted === true) {
      metrics.turns.inc({ outcome: "interrupted" });
    } else {
      metrics.openAiFailures.inc({ stage: failureStage });
      metrics.cloudRequests.inc({ stage: failureStage, outcome: "failure" });
      metrics.turns.inc({ outcome: "error" });
    }
    try {
      await input.assistantAudio.cancel();
    } catch {
      // Cancellation is cleanup. If it fails we still owe the caller the
      // reason we got here, so never let it replace `error`.
      metrics.replySendFailures.inc();
    }
    throw error;
  } finally {
    session.close();
    metrics.concurrentTurns.dec();
  }
}
