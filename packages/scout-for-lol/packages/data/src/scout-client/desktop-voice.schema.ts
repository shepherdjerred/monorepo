import { z } from "zod";
import {
  EXPLORE_QUESTION_MAX_LENGTH,
  ExploreConversationIdSchema,
} from "#src/model/reports/explore.ts";
import {
  COACH_GAME_CONTEXT_MAX_BYTES,
  CoachGameContextSchema,
} from "./coach-context.schema.ts";

/*
 * Voice turns (contract version 8): `coach/voice/turns`.
 *
 * A spoken question is one finished utterance the desktop recorded locally,
 * uploaded whole: the microphone never streams. The server transcribes it
 * itself and the route takes no text, which is what proves the player asked:
 * a `wake_word` turn must also open with the wake phrase in the server's own
 * transcript (`verifyWakeTranscript`), and the phrase is stripped before the
 * question starts an Explore turn. The answer streams back as events, ending
 * with the spoken answer's audio.
 */
export const SCOUT_DESKTOP_VOICE_TURN = {
  triggers: ["wake_word", "push_to_talk"],
  audio: {
    mediaType: "audio/wav",
    sampleRateHz: 16_000,
    channels: 1,
    bitsPerSample: 16,
    minDurationMs: 200,
    maxDurationMs: 15_000,
  },
  speech: {
    encoding: "pcm_s16le",
    sampleRateHz: 24_000,
    channels: 1,
    maxChunkBytes: 48_000,
  },
  events: ["transcript", "run", "answer", "audio", "error", "done"],
  errors: [
    "wake_not_verified",
    "empty_question",
    "transcription_failed",
    "budget_exhausted",
    "quota_exceeded",
    "conversation_busy",
    "invalid_turn",
    "not_found",
    "unavailable",
    "answer_failed",
    "synthesis_failed",
  ],
} as const;

/** The WAV header the route accepts: RIFF, `fmt `, then `data`, 44 bytes. */
export const SCOUT_DESKTOP_VOICE_WAV_HEADER_BYTES = 44;
const VOICE_BYTES_PER_MS =
  (SCOUT_DESKTOP_VOICE_TURN.audio.sampleRateHz *
    SCOUT_DESKTOP_VOICE_TURN.audio.channels *
    (SCOUT_DESKTOP_VOICE_TURN.audio.bitsPerSample / 8)) /
  1000;
/** The largest utterance: the longest the desktop records, as one WAV. */
export const SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES =
  SCOUT_DESKTOP_VOICE_WAV_HEADER_BYTES +
  SCOUT_DESKTOP_VOICE_TURN.audio.maxDurationMs * VOICE_BYTES_PER_MS;
/** The shortest utterance: anything briefer is not speech. */
export const SCOUT_DESKTOP_VOICE_MIN_WAV_BYTES =
  SCOUT_DESKTOP_VOICE_WAV_HEADER_BYTES +
  SCOUT_DESKTOP_VOICE_TURN.audio.minDurationMs * VOICE_BYTES_PER_MS;
const VOICE_MAX_BASE64_LENGTH =
  4 * Math.ceil(SCOUT_DESKTOP_VOICE_MAX_WAV_BYTES / 3);
/** The largest voice body: the longest utterance plus the largest context. */
export const SCOUT_DESKTOP_VOICE_TURN_MAX_BYTES =
  VOICE_MAX_BASE64_LENGTH + COACH_GAME_CONTEXT_MAX_BYTES + 1024;

export const ScoutDesktopVoiceTriggerSchema = z.enum(
  SCOUT_DESKTOP_VOICE_TURN.triggers,
);
export type ScoutDesktopVoiceTrigger = z.infer<
  typeof ScoutDesktopVoiceTriggerSchema
>;

/**
 * `coach/voice/turns`: one utterance, how it began, the conversation it
 * continues, and the game the player is in. There is no text field: the
 * question is whatever the server hears.
 */
export const ScoutDesktopVoiceTurnRequestSchema = z.strictObject({
  trigger: ScoutDesktopVoiceTriggerSchema,
  /** Null starts a new conversation. */
  conversationId: ExploreConversationIdSchema.nullable(),
  audio: z.strictObject({
    mediaType: z.literal(SCOUT_DESKTOP_VOICE_TURN.audio.mediaType),
    base64: z
      .string()
      .min(4)
      .max(VOICE_MAX_BASE64_LENGTH)
      .regex(/^[A-Z0-9+/]+={0,2}$/i),
  }),
  gameContext: CoachGameContextSchema.optional(),
});
export type ScoutDesktopVoiceTurnRequest = z.infer<
  typeof ScoutDesktopVoiceTurnRequestSchema
>;

/**
 * How the server judged the wake phrase: `verified` when a `wake_word`
 * turn's transcript opened with it, `not_required` for push-to-talk. A
 * `wake_word` turn whose transcript does not open with it never reaches a
 * `transcript` event; it ends with `wake_not_verified`.
 */
export const ScoutDesktopVoiceWakeVerificationSchema = z.enum([
  "verified",
  "not_required",
]);
export type ScoutDesktopVoiceWakeVerification = z.infer<
  typeof ScoutDesktopVoiceWakeVerificationSchema
>;

export const ScoutDesktopVoiceTurnErrorCodeSchema = z.enum(
  SCOUT_DESKTOP_VOICE_TURN.errors,
);
export type ScoutDesktopVoiceTurnErrorCode = z.infer<
  typeof ScoutDesktopVoiceTurnErrorCodeSchema
>;

/**
 * The frames of one `coach/voice/turns` response, in order:
 *
 * - `transcript`: the question as the server heard it, wake phrase stripped.
 * - `run`: the Explore turn it started, which `runs/stream` can also follow.
 * - `answer`: the saved answer's text and the shorter text Scout speaks.
 * - `audio`: the spoken answer, in order, as raw PCM chunks.
 * - `error`: why the turn stopped short, with a retry hint when one applies.
 *   An `error` after `answer` (`synthesis_failed`) leaves the answer standing.
 * - `done`: always last. `refused` means no Explore turn ran.
 */
export const ScoutDesktopVoiceTurnEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("transcript"),
    text: z.string().min(1).max(EXPLORE_QUESTION_MAX_LENGTH),
    trigger: ScoutDesktopVoiceTriggerSchema,
    wake: ScoutDesktopVoiceWakeVerificationSchema,
  }),
  z.strictObject({
    type: z.literal("run"),
    runId: z.uuid(),
    conversationId: ExploreConversationIdSchema,
    questionMessageId: z.uuid(),
  }),
  z.strictObject({
    type: z.literal("answer"),
    messageId: z.uuid(),
    text: z.string(),
    spokenText: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("audio"),
    sequence: z.number().int().nonnegative(),
    encoding: z.literal(SCOUT_DESKTOP_VOICE_TURN.speech.encoding),
    sampleRateHz: z.literal(SCOUT_DESKTOP_VOICE_TURN.speech.sampleRateHz),
    base64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(SCOUT_DESKTOP_VOICE_TURN.speech.maxChunkBytes / 3))
      .regex(/^[A-Z0-9+/]+={0,2}$/i),
  }),
  z.strictObject({
    type: z.literal("error"),
    code: ScoutDesktopVoiceTurnErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryAfterSeconds: z.number().int().positive().nullable(),
  }),
  z.strictObject({
    type: z.literal("done"),
    outcome: z.enum([
      "succeeded",
      "failed",
      "stopped",
      "interrupted",
      "refused",
    ]),
  }),
]);
export type ScoutDesktopVoiceTurnEvent = z.infer<
  typeof ScoutDesktopVoiceTurnEventSchema
>;

/** Every voice event type, in `ScoutDesktopVoiceTurnEventSchema`'s order. */
export const SCOUT_DESKTOP_VOICE_TURN_EVENT_TYPES: readonly string[] =
  ScoutDesktopVoiceTurnEventSchema.options.map(
    (option) => option.shape.type.value,
  );

/** A voice turn's golden frames, as `runs/stream`'s fixture holds its own. */
export const ScoutDesktopVoiceTurnStreamResponseSchema = z.strictObject({
  events: z.array(ScoutDesktopVoiceTurnEventSchema),
});
