import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import type {
  RealtimeAgentConfiguration,
  RealtimeTransportLayer,
} from "@openai/agents/realtime";
import { wakePcmToOpenAiPcm } from "@shepherdjerred/voice-assistant/audio/codecs.ts";
import type { AssistantAudioSink } from "@shepherdjerred/voice-assistant/assistant-sink.ts";
import type { SpokenFeedbackClips } from "@shepherdjerred/voice-assistant/spoken-feedback.ts";
import {
  NOOP_VOICE_ATTEMPT_OBSERVER,
  type VoiceAttemptHandle,
} from "./attempt.ts";
import { VoiceMutationGate } from "@shepherdjerred/voice-assistant/mutation-gate.ts";
import type {
  RealtimeTurnMetrics,
  VoiceObservability,
} from "@shepherdjerred/voice-assistant/ports.ts";
import { realtimeErrorToError } from "./realtime-errors.ts";
import {
  OutputAudioTranscriptEventSchema,
  TranscriptionCompletedEventSchema,
  TranscriptionFailedEventSchema,
  type CompletedTranscription,
} from "./realtime-events.ts";
import { buildRealtimeSessionConfig } from "./realtime-transcript.ts";
import {
  createVerifiedCommandItem,
  deleteInputAudioItem,
  finishBareWakeTurn,
  finishRealtimeResponseTurn,
  finishRejectedWakeTurn,
  resolveTurnWake,
  runVerifiedCommandRoute,
} from "./realtime-turn-helpers.ts";

export type RealtimeTurnTools = NonNullable<
  RealtimeAgentConfiguration["tools"]
>;

export type RealtimeTurnToolContext = {
  readonly mutationGate: VoiceMutationGate;
  readonly signal: AbortSignal;
  readonly attempt: VoiceAttemptHandle;
};

export type RealtimeVerifiedCommandRouteInput = {
  readonly command: string;
  readonly transcript: string;
  readonly signal: AbortSignal;
  readonly mutationGate: VoiceMutationGate;
  readonly attempt: VoiceAttemptHandle;
  readonly assistantAudio: AssistantAudioSink;
};

export type RealtimeVerifiedCommandRouteResult =
  | {
      readonly handled: true;
      readonly toolCalls?: readonly string[];
      readonly assistantText?: string;
      readonly mutated?: boolean;
    }
  | {
      readonly handled: false;
    };

export type RealtimeVerifiedCommandRouter = (
  input: RealtimeVerifiedCommandRouteInput,
) => Promise<RealtimeVerifiedCommandRouteResult>;

/**
 * Everything phrase-, product-, and account-specific about one Realtime command turn.
 * The turn mechanics (privacy invariants, abort/timeout races, response.create-free rejected,
 * bare-wake, and pre-response routed paths) live in {@link runRealtimeCommandTurn} and never vary
 * per consumer.
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
  /**
   * Optional pre-response hook invoked after wake verification and raw-audio item deletion,
   * before `conversation.item.create` + `response.create`. Returning `{ handled: true, ... }`
   * skips the Realtime response entirely and closes the session cleanly.
   */
  readonly routeVerifiedCommand?: RealtimeVerifiedCommandRouter;
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
  readonly toolCalls?: readonly string[];
  readonly assistantText?: string;
  /**
   * Left unset by this package — it has no concept of "clarification". A consumer whose tools
   * can ask a clarifying question computes this itself (see streambot's `realtime-voice.ts`)
   * and augments the result before returning it to its own callers.
   */
  readonly clarificationRequested?: boolean;
};

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
  const markFirstAudio = (): boolean => {
    if (!firstAudio) return false;
    firstAudio = false;
    return true;
  };
  let failureStage = "connect";
  const replyTranscriptParts: string[] = [];
  const observedToolCallNames: string[] = [];
  const transcription = new Promise<CompletedTranscription>(
    (resolve, reject) => {
      session.on("transport_event", (event) => {
        const outputTranscript =
          OutputAudioTranscriptEventSchema.safeParse(event);
        if (outputTranscript.success) {
          replyTranscriptParts.push(outputTranscript.data.transcript);
          attempt.replyTranscript(outputTranscript.data.transcript);
        }
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
    session.transport.on("function_call", (call) => {
      observedToolCalls += 1;
      observedToolCallNames.push(call.name);
    });
    session.on("agent_tool_end", () => {
      completedToolCalls += 1;
    });
    session.on("audio", (event) => {
      if (markFirstAudio()) {
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
    const verified = resolveTurnWake(
      transcriptionResult.transcript,
      options.wakePrefixes,
      input.wakeRequired,
    );
    if (verified === null) {
      return await finishRejectedWakeTurn({
        transcript: transcriptionResult.transcript,
        feedbackClips: input.feedbackClips,
        assistantAudio: input.assistantAudio,
        interruption,
        attempt,
        metrics,
      });
    }
    attempt.transcription({
      transcript: transcriptionResult.transcript,
      normalizedCommand: verified.command,
      outcome: "accepted",
    });
    metrics.transcriptVerifications.inc({ outcome: "accepted" });
    if (verified.command.length === 0) {
      return await finishBareWakeTurn({
        transcript: transcriptionResult.transcript,
        feedbackClips: input.feedbackClips,
        assistantAudio: input.assistantAudio,
        interruption,
        metrics,
      });
    }
    failureStage = "verified-command";
    await deleteInputAudioItem(
      session,
      transcriptionResult.item_id,
      interruption,
      sessionFailure,
    );

    if (options.routeVerifiedCommand !== undefined) {
      failureStage = "command-routing";
      const routedResult = await runVerifiedCommandRoute({
        routeVerifiedCommand: options.routeVerifiedCommand,
        command: verified.command,
        transcript: transcriptionResult.transcript,
        activatedAtMs: input.activatedAtMs,
        transactionSignal,
        interruption,
        mutationGate,
        attempt,
        assistantAudio: input.assistantAudio,
        metrics,
        stagePrefix,
        markFirstAudio,
      });
      if (routedResult !== null) return routedResult;
      failureStage = "verified-command";
    }

    await createVerifiedCommandItem(
      session,
      verified.command,
      interruption,
      sessionFailure,
    );
    failureStage = "response";
    metrics.cloudRequests.inc({ stage: "response", outcome: "request" });
    await attempt.runStage(`${stagePrefix}.openai.response`, {}, async () => {
      session.transport.sendEvent({ type: "response.create" });
      await Promise.race([completed, interruption, sessionFailure]);
    });
    metrics.cloudRequests.inc({ stage: "response", outcome: "success" });
    // `audio_stopped` only means Realtime finished generating. The sink still paces whatever it
    // queued at 20 ms per packet, so leaving this await unraced lets a long or fast-generated
    // reply drain past the transaction timeout — holding the duck down, the teardown hold open,
    // and the lifecycle's input gate shut. On expiry the catch below cancels the sink, which
    // truncates the queue and lets this drain settle within one packet.
    await Promise.race([input.assistantAudio.finish(), interruption]);
    return finishRealtimeResponseTurn({
      session,
      transcriptionResult,
      command: verified.command,
      mutationGate,
      observedToolCallNames,
      replyTranscriptParts,
      metrics,
      attempt,
    });
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
