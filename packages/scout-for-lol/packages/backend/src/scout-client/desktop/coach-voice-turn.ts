import {
  ExploreTurnRequestSchema,
  SCOUT_DESKTOP_VOICE_TURN,
  ScoutDesktopVoiceTurnEventSchema,
  type DiscordAccountId,
  type ExploreActiveRun,
  type ExploreTurnRequest,
  type ScoutDesktopVoiceTrigger,
  type ScoutDesktopVoiceTurnErrorCode,
  type ScoutDesktopVoiceTurnEvent,
} from "@scout-for-lol/data";
import { isQuotaExhaustedError } from "@shepherdjerred/voice-assistant";
import {
  VOICE_TRANSCRIPTION_MODEL,
  transcribeVoiceQuestion,
} from "@shepherdjerred/voice-assistant/openai-audio.ts";
import type { CoachTurnRecord } from "#src/coach/audit.ts";
import type { CoachContextProjection } from "#src/coach/context-policy.ts";
import {
  proveVoiceInitiation,
  type VoiceUtterance,
} from "#src/coach/voice-turn.ts";
import { prisma } from "#src/database/index.ts";
import { subscribeDurableExploreRun } from "#src/explore/runs/durable-runs.ts";
import { exploreRunManager } from "#src/explore/runs/run-manager.ts";
import { classifyExploreStartError } from "#src/explore/runs/start-refusal.ts";
import { loadExploreRunResult } from "#src/explore/store.ts";
import { createLogger } from "#src/logger.ts";
import { voiceAudioRequestSignal } from "#src/voice-assistant/constants.ts";
import type { DesktopExploreCaller } from "./auth.ts";
import {
  holdAudio,
  pcmChunks,
  releaseAudio,
  settleAudio,
  speakHeld,
} from "./coach-speech.ts";

/**
 * One spoken coach turn after `coach-voice-routes.ts` admitted it: hear the
 * question, prove the player asked, run it as a durable Explore turn, and
 * speak the answer, all written to one event stream.
 *
 * Transcription and speech are the calls Discord voice makes, and both are
 * recorded in the Explore spend ledger by the length of audio sent and
 * received. A provider budget refusal on either, or the ledger's own, ends the
 * turn with `budget_exhausted`.
 */

const logger = createLogger("coach-voice-turns");
const encoder = new TextEncoder();
const MESSAGE_MAX_LENGTH = 500;

/** What the player is told for each refusal the turn words itself. */
export const VOICE_MESSAGES = {
  wake_not_verified:
    'Scout did not hear "hey scout" at the start, so it did not answer.',
  empty_question: "Scout did not hear a question.",
  transcription_failed: "Scout could not make out the recording. Try again.",
  budget_exhausted:
    "Scout's spending allowance is used up for now, so it cannot answer by voice.",
  answer_failed: "Scout could not finish that answer.",
  synthesis_failed:
    "Scout could not speak the answer. It is saved in the conversation.",
  unavailable: "Scout's voice answers are unavailable right now.",
} as const satisfies Partial<Record<ScoutDesktopVoiceTurnErrorCode, string>>;

const START_REFUSAL_CODES = {
  busy: "conversation_busy",
  rate_limited: "quota_exceeded",
  unavailable: "unavailable",
  not_found: "not_found",
  invalid_turn: "invalid_turn",
} as const satisfies Record<string, ScoutDesktopVoiceTurnErrorCode>;

function clipped(message: string): string {
  return message.length <= MESSAGE_MAX_LENGTH
    ? message
    : `${message.slice(0, MESSAGE_MAX_LENGTH - 1)}…`;
}

/** The SSE body a voice turn writes, tolerant of a reader that went away. */
export function createVoiceStream(onCancel: () => void) {
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllers.push(controller);
    },
    cancel() {
      closed = true;
      onCancel();
    },
  });
  const controller = controllers[0];
  if (controller === undefined) {
    throw new Error("Voice turn stream did not initialize.");
  }
  const write = (text: string): void => {
    if (!closed) controller.enqueue(encoder.encode(text));
  };
  return {
    stream,
    emit(event: ScoutDesktopVoiceTurnEvent): void {
      const parsed = ScoutDesktopVoiceTurnEventSchema.parse(event);
      write(`event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`);
    },
    /** An SSE comment, so a reader's idle timeout never fires mid-answer. */
    keepalive(): void {
      write(": keepalive\n\n");
    },
    close(): void {
      if (closed) return;
      closed = true;
      controller.close();
    },
  };
}
export type VoiceStream = ReturnType<typeof createVoiceStream>;

export function emitVoiceError(
  stream: VoiceStream,
  code: ScoutDesktopVoiceTurnErrorCode,
  message: string,
  retryAfterSeconds: number | null = null,
): void {
  stream.emit({
    type: "error",
    code,
    message: clipped(message),
    retryAfterSeconds,
  });
}

export type VoiceTurnInput = {
  readonly caller: DesktopExploreCaller;
  readonly apiKey: string;
  readonly utterance: VoiceUtterance;
  readonly trigger: ScoutDesktopVoiceTrigger;
  readonly conversationId: string | null;
  readonly flags: CoachTurnRecord["flags"];
  readonly projection: CoachContextProjection;
  /** Aborted when the reader leaves; the Explore run keeps going. */
  readonly signal: AbortSignal;
};

/** How a voice turn ended, as its `done` event says. */
export type VoiceTurnOutcome = Extract<
  ScoutDesktopVoiceTurnEvent,
  { type: "done" }
>["outcome"];

type HeardQuestion =
  | {
      readonly ok: true;
      readonly request: ExploreTurnRequest;
      readonly question: string;
      readonly wake: "verified" | "not_required";
      readonly spend: (runId: string) => Promise<void>;
    }
  | { readonly ok: false; readonly outcome: VoiceTurnOutcome | null };

/**
 * Transcribe the utterance and prove from that transcript that the player
 * asked. The allowance is held before the provider hears anything, and spent
 * whether or not a turn follows; `spend` books it against the run once there
 * is one.
 */
async function hearQuestion(
  input: VoiceTurnInput,
  stream: VoiceStream,
): Promise<HeardQuestion> {
  const refuse = (code: keyof typeof VOICE_MESSAGES): HeardQuestion => {
    emitVoiceError(stream, code, VOICE_MESSAGES[code]);
    return { ok: false, outcome: "refused" };
  };
  const hold = await holdAudio(
    input.caller.userId,
    VOICE_TRANSCRIPTION_MODEL,
    input.utterance.durationMs,
  );
  if (hold === null) return refuse("budget_exhausted");
  let transcript: string;
  try {
    transcript = await transcribeVoiceQuestion({
      apiKey: input.apiKey,
      pcm16k: input.utterance.pcm16k,
      signal: voiceAudioRequestSignal(input.signal),
    });
  } catch (error) {
    await releaseAudio(hold);
    if (input.signal.aborted) return { ok: false, outcome: null };
    const budget = isQuotaExhaustedError(error);
    logger.warn("Voice turn transcription failed", {
      deviceId: input.caller.device.deviceId,
      budget,
      error: error instanceof Error ? error.message : String(error),
    });
    return refuse(budget ? "budget_exhausted" : "transcription_failed");
  }
  const spend = (runId: string): Promise<void> =>
    settleAudio(hold, runId, input.utterance.durationMs);
  const proof = proveVoiceInitiation(transcript, input.trigger);
  const turn = proof.ok
    ? ExploreTurnRequestSchema.safeParse({
        conversationId: input.conversationId,
        question: proof.question,
        attach: { kind: "leaf" },
      })
    : null;
  if (!proof.ok || turn?.success !== true || turn.data.question === null) {
    await spend(globalThis.crypto.randomUUID());
    return refuse(proof.ok ? "empty_question" : proof.code);
  }
  return {
    ok: true,
    request: turn.data,
    question: turn.data.question,
    wake: proof.wake,
    spend,
  };
}

async function waitForOutcome(
  runId: string,
  userId: DiscordAccountId,
  signal: AbortSignal,
): Promise<Exclude<VoiceTurnOutcome, "refused"> | null> {
  const deferred = Promise.withResolvers<Exclude<
    VoiceTurnOutcome,
    "refused"
  > | null>();
  // The worker may run in another process, so a local placeholder would never
  // see completion; observe the persisted run row directly.
  const unsubscribe = await subscribeDurableExploreRun(
    prisma,
    runId,
    userId,
    (event) => {
      if (event.type === "done") deferred.resolve(event.outcome);
    },
  );
  if (unsubscribe === null) {
    throw new Error("A voice turn's own run could not be observed");
  }
  // The run keeps going when the player stops listening; only this wait ends.
  const abandon = (): void => {
    deferred.resolve(null);
  };
  signal.addEventListener("abort", abandon, { once: true });
  try {
    return await deferred.promise;
  } finally {
    signal.removeEventListener("abort", abandon);
    unsubscribe();
  }
}

/** Why a finished run did not succeed, as the voice stream names it. */
async function failureCode(
  runId: string,
): Promise<"budget_exhausted" | "answer_failed"> {
  const row = await prisma.scoutInteractiveRun.findUnique({
    where: { id: runId },
    select: { lastError: true },
  });
  return row?.lastError === "explore:budget_exceeded"
    ? "budget_exhausted"
    : "answer_failed";
}

/** Speak `text`, as ordered PCM chunks, and book the speech it took. */
async function speak(
  input: VoiceTurnInput,
  stream: VoiceStream,
  runId: string,
  text: string,
): Promise<void> {
  const spoken = await speakHeld({
    ownerId: input.caller.userId,
    apiKey: input.apiKey,
    runId,
    text,
    signal: input.signal,
  });
  if (!spoken.ok) {
    if (spoken.reason === "aborted") return;
    const code =
      spoken.reason === "budget" ? "budget_exhausted" : "synthesis_failed";
    emitVoiceError(stream, code, VOICE_MESSAGES[code]);
    return;
  }
  const { maxChunkBytes, encoding, sampleRateHz } =
    SCOUT_DESKTOP_VOICE_TURN.speech;
  pcmChunks(spoken.pcm, maxChunkBytes).forEach((base64, sequence) => {
    stream.emit({ type: "audio", sequence, encoding, sampleRateHz, base64 });
  });
}

/** Wait for the run, then send its answer and speak it. */
async function answerAloud(
  input: VoiceTurnInput,
  stream: VoiceStream,
  run: ExploreActiveRun,
): Promise<VoiceTurnOutcome | null> {
  const outcome = await waitForOutcome(
    run.runId,
    input.caller.userId,
    input.signal,
  );
  if (outcome === null) return null;
  try {
    if (outcome !== "succeeded") {
      const code = await failureCode(run.runId);
      emitVoiceError(stream, code, VOICE_MESSAGES[code]);
      return outcome;
    }
    const result = await loadExploreRunResult(prisma, {
      runId: run.runId,
      conversationId: run.conversationId,
      userId: input.caller.userId,
    });
    if (result === null) {
      throw new Error("A succeeded voice turn has no saved answer");
    }
    if (result.spokenContent === null) {
      throw new Error("A succeeded voice turn has no spoken answer");
    }
    stream.emit({
      type: "answer",
      messageId: result.answer.id,
      text: result.answer.content,
      spokenText: result.spokenContent,
    });
    await speak(input, stream, run.runId, result.spokenContent);
    return outcome;
  } finally {
    exploreRunManager.settleDurablePlaceholder(run.runId, outcome);
  }
}

/**
 * One spoken turn, written to `stream`. The question is the server's
 * transcript, proven player-initiated before any Explore turn starts. Returns
 * how it ended for the caller's `done`, or null when the reader left first.
 * `started` is set once an Explore run exists, so a failure thrown after it is
 * reported as `failed` rather than `refused`.
 */
export async function runVoiceTurn(
  input: VoiceTurnInput,
  stream: VoiceStream,
  started: { runId: string | null },
): Promise<VoiceTurnOutcome | null> {
  const heard = await hearQuestion(input, stream);
  if (!heard.ok) return heard.outcome;
  stream.emit({
    type: "transcript",
    text: heard.question,
    trigger: input.trigger,
    wake: heard.wake,
  });
  const coach: CoachTurnRecord = {
    deviceId: input.caller.device.deviceId,
    initiation: "player_voice",
    // A spoken turn belongs to no app-started game; only those count by key.
    gameKey: null,
    flags: input.flags,
    projection: input.projection,
    voice: { trigger: input.trigger, wake: heard.wake },
  };
  let run: ExploreActiveRun;
  try {
    // `voice` delivers a spoken summary beside the saved answer. The audit
    // row, with the trigger and wake verification, commits in the
    // transaction that reserves the run.
    run = await exploreRunManager.start(
      { userId: input.caller.userId },
      heard.request,
      input.caller.guildIds,
      { surface: "voice", coach },
    );
  } catch (error) {
    await heard.spend(globalThis.crypto.randomUUID());
    const refusal = classifyExploreStartError(error);
    if (refusal === null) throw error;
    emitVoiceError(
      stream,
      START_REFUSAL_CODES[refusal.kind],
      refusal.message,
      refusal.kind === "rate_limited" ? refusal.retryAfterSeconds : null,
    );
    return "refused";
  }
  started.runId = run.runId;
  await heard.spend(run.runId);
  stream.emit({
    type: "run",
    runId: run.runId,
    conversationId: run.conversationId,
    questionMessageId: run.questionMessageId,
  });
  return await answerAloud(input, stream, run);
}
