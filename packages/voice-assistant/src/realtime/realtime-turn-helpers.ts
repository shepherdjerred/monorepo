import type { RealtimeSession } from "@openai/agents/realtime";
import type { AssistantAudioSink } from "@shepherdjerred/voice-assistant/assistant-sink.ts";
import type { VoiceMutationGate } from "@shepherdjerred/voice-assistant/mutation-gate.ts";
import type { RealtimeTurnMetrics } from "@shepherdjerred/voice-assistant/ports.ts";
import type { SpokenFeedbackClips } from "@shepherdjerred/voice-assistant/spoken-feedback.ts";
import type { VoiceAttemptHandle } from "./attempt.ts";
import {
  ConversationItemCreatedEventSchema,
  ConversationItemDeletedEventSchema,
  type CompletedTranscription,
} from "./realtime-events.ts";
import {
  normalizeTranscript,
  verifyWakeTranscript,
  type VerifiedWakeTranscript,
} from "./realtime-transcript.ts";
import type {
  RealtimeCommandTurnResult,
  RealtimeVerifiedCommandRouter,
} from "./realtime-turn.ts";

function audioTokenCount(details: readonly Record<string, number>[]): number {
  return details.reduce(
    (total, item) => total + (item["audio_tokens"] ?? 0),
    0,
  );
}

export function resolveTurnWake(
  transcript: string,
  wakePrefixes: readonly string[],
  wakeRequired: boolean | undefined,
): VerifiedWakeTranscript | null {
  if (wakeRequired === false) {
    const normalized = normalizeTranscript(transcript);
    return { normalized, command: normalized };
  }
  return verifyWakeTranscript(transcript, wakePrefixes);
}

export function finishRealtimeResponseTurn(options: {
  readonly session: RealtimeSession;
  readonly transcriptionResult: CompletedTranscription;
  readonly command: string;
  readonly mutationGate: VoiceMutationGate;
  readonly observedToolCallNames: readonly string[];
  readonly replyTranscriptParts: readonly string[];
  readonly metrics: RealtimeTurnMetrics;
  readonly attempt: VoiceAttemptHandle;
}): RealtimeCommandTurnResult {
  const inputAudio = audioTokenCount(options.session.usage.inputTokensDetails);
  const outputAudio = audioTokenCount(
    options.session.usage.outputTokensDetails,
  );
  if (inputAudio > 0) {
    options.metrics.audioTokens.inc({ direction: "input" }, inputAudio);
  }
  if (outputAudio > 0) {
    options.metrics.audioTokens.inc({ direction: "output" }, outputAudio);
  }
  options.attempt.cloudUsage({
    transcription: options.transcriptionResult.usage,
    realtime: {
      inputAudioTokens: inputAudio,
      outputAudioTokens: outputAudio,
    },
  });
  options.metrics.turns.inc({
    outcome: options.mutationGate.hasMutated ? "command" : "no-command",
  });
  options.attempt.cloudOutcome("success");
  const assistantText =
    options.replyTranscriptParts.length === 0
      ? undefined
      : options.replyTranscriptParts.join(" ");
  return {
    transcript: options.transcriptionResult.transcript,
    wakeVerified: true,
    mutated: options.mutationGate.hasMutated,
    normalizedCommand: options.command,
    toolCalls: [...options.observedToolCallNames],
    ...(assistantText === undefined ? {} : { assistantText }),
  };
}

export async function finishLocalFeedbackClip(
  assistantAudio: AssistantAudioSink,
  clip: Uint8Array | undefined,
  interruption: Promise<never>,
): Promise<void> {
  if (clip === undefined) {
    await assistantAudio.cancel();
    return;
  }
  assistantAudio.enqueue(clip);
  await Promise.race([assistantAudio.finish(), interruption]);
}

export async function finishRejectedWakeTurn(options: {
  readonly transcript: string;
  readonly feedbackClips: SpokenFeedbackClips | undefined;
  readonly assistantAudio: AssistantAudioSink;
  readonly interruption: Promise<never>;
  readonly attempt: VoiceAttemptHandle;
  readonly metrics: RealtimeTurnMetrics;
}): Promise<RealtimeCommandTurnResult> {
  options.attempt.transcription({
    transcript: options.transcript,
    normalizedCommand: null,
    outcome: "rejected",
  });
  options.attempt.cloudOutcome("transcript-rejected");
  options.metrics.transcriptVerifications.inc({ outcome: "rejected" });
  options.metrics.turns.inc({ outcome: "transcript-rejected" });
  // Still response.create-free: the retry line is a local pre-rendered clip, so nothing
  // about the rejected audio reaches the Realtime model — but the speaker is no longer
  // left wondering whether the assistant heard anything at all.
  await finishLocalFeedbackClip(
    options.assistantAudio,
    options.feedbackClips?.retry,
    options.interruption,
  );
  return {
    transcript: options.transcript,
    wakeVerified: false,
    mutated: false,
    normalizedCommand: null,
    toolCalls: [],
  };
}

export async function finishBareWakeTurn(options: {
  readonly transcript: string;
  readonly feedbackClips: SpokenFeedbackClips | undefined;
  readonly assistantAudio: AssistantAudioSink;
  readonly interruption: Promise<never>;
  readonly metrics: RealtimeTurnMetrics;
}): Promise<RealtimeCommandTurnResult> {
  // A bare wake phrase used to bill a full Realtime response just to ask what to do.
  // The prompt is a local clip instead; no conversation item is created and no response is
  // requested, and the caller's finally closes the session immediately.
  options.metrics.turns.inc({ outcome: "bare-wake" });
  await finishLocalFeedbackClip(
    options.assistantAudio,
    options.feedbackClips?.prompt,
    options.interruption,
  );
  return {
    transcript: options.transcript,
    wakeVerified: true,
    mutated: false,
    normalizedCommand: "",
    toolCalls: [],
  };
}

export async function deleteInputAudioItem(
  session: RealtimeSession,
  itemId: string,
  interruption: Promise<never>,
  sessionFailure: Promise<never>,
): Promise<void> {
  const deleted = new Promise<void>((resolve) => {
    session.on("transport_event", (event) => {
      const parsed = ConversationItemDeletedEventSchema.safeParse(event);
      if (parsed.success && parsed.data.item_id === itemId) {
        resolve();
      }
    });
  });
  session.transport.sendEvent({
    type: "conversation.item.delete",
    item_id: itemId,
  });
  await Promise.race([deleted, interruption, sessionFailure]);
}

export async function createVerifiedCommandItem(
  session: RealtimeSession,
  command: string,
  interruption: Promise<never>,
  sessionFailure: Promise<never>,
): Promise<void> {
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
      content: [{ type: "input_text", text: command }],
    },
  });
  await Promise.race([created, interruption, sessionFailure]);
}

export async function runVerifiedCommandRoute(options: {
  readonly routeVerifiedCommand: RealtimeVerifiedCommandRouter;
  readonly command: string;
  readonly transcript: string;
  readonly activatedAtMs: number;
  readonly transactionSignal: AbortSignal;
  readonly interruption: Promise<never>;
  readonly mutationGate: VoiceMutationGate;
  readonly attempt: VoiceAttemptHandle;
  readonly assistantAudio: AssistantAudioSink;
  readonly metrics: RealtimeTurnMetrics;
  readonly stagePrefix: string;
  readonly markFirstAudio: () => boolean;
}): Promise<RealtimeCommandTurnResult | null> {
  const audioState = { enqueued: false };
  const routedAssistantAudio: AssistantAudioSink = {
    enqueue: (pcm24k) => {
      if (options.markFirstAudio()) {
        options.metrics.wakeToReplySeconds.observe(
          (Date.now() - options.activatedAtMs) / 1000,
        );
      }
      audioState.enqueued = true;
      options.assistantAudio.enqueue(pcm24k);
    },
    finish: () => options.assistantAudio.finish(),
    cancel: () => options.assistantAudio.cancel(),
  };
  const routed = await options.attempt.runStage(
    `${options.stagePrefix}.command_routing`,
    {},
    async (span) => {
      const decision = await Promise.race([
        options.routeVerifiedCommand({
          command: options.command,
          transcript: options.transcript,
          signal: options.transactionSignal,
          mutationGate: options.mutationGate,
          attempt: options.attempt,
          assistantAudio: routedAssistantAudio,
        }),
        options.interruption,
      ]);
      span.setAttribute(
        `${options.stagePrefix}.command_routing.handled`,
        decision.handled,
      );
      return decision;
    },
  );
  if (!routed.handled) return null;
  if (routed.assistantText !== undefined && routed.assistantText.length > 0) {
    options.attempt.replyTranscript(routed.assistantText);
  }
  if (audioState.enqueued) {
    await Promise.race([options.assistantAudio.finish(), options.interruption]);
  } else {
    await options.assistantAudio.cancel();
  }
  const toolCalls = [...(routed.toolCalls ?? [])];
  const mutated =
    routed.mutated ?? (options.mutationGate.hasMutated || toolCalls.length > 0);
  options.metrics.turns.inc({ outcome: mutated ? "command" : "no-command" });
  options.attempt.cloudOutcome("success");
  return {
    transcript: options.transcript,
    wakeVerified: true,
    mutated,
    normalizedCommand: options.command,
    toolCalls,
    ...(routed.assistantText === undefined
      ? {}
      : { assistantText: routed.assistantText }),
  };
}
