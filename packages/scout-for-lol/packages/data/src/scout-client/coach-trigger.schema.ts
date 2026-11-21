import { z } from "zod";
import { ExploreActiveRunSchema } from "#src/model/reports/explore.ts";
import { CoachGameKeySchema, CoachLiveSchema } from "./coach-context.schema.ts";
import { SCOUT_DESKTOP_VOICE_TURN } from "./desktop-voice.schema.ts";

/**
 * `coach/triggers`: a proactive coach turn Scout Desktop asks for because one
 * of its deterministic detectors saw a scoreboard change. Beta only.
 *
 * Riot's published policy prohibits unprompted alerts from live game state,
 * so this route is hard-refused in production whatever any flag says
 * (`backend/src/coach/proactive-policy.ts`), and elsewhere admitted only with
 * `scout_coach_proactive`, `scout_coach_live_answers` and `scout_desktop_coach`
 * all on. The body carries no free text: a trigger kind, the detector's
 * evidence (scoreboard values only), and the live snapshot the evidence was
 * read from. The server words the question, checks the evidence against the
 * snapshot, and bounds the turns itself (`COACH_PROACTIVE_LIMITS`).
 *
 * The Rust client holds the golden fixture
 * (`desktop-fixtures/coach-triggers.json`) to strict serde types in
 * `scout-client-core/src/desktop_api.rs`; its detectors live in
 * `scout-client-core/src/live/detectors.rs` and are compiled only into the
 * beta release profile.
 */

/**
 * What a detector saw, between two consecutive live snapshots:
 *
 * - `enemy_item_spike`: an enemy completed a legendary item.
 * - `enemy_fed`: an enemy crossed the fed threshold on kills against deaths.
 * - `damage_profile_shift`: the enemy team's completed damage items changed
 *   which damage type dominates.
 * - `healing_threat`: the enemy team's completed healing items crossed a
 *   threshold while the player holds no anti-heal item.
 * - `death_streak`: the player died several times without a takedown.
 */
export const COACH_TRIGGER_KINDS = [
  "enemy_item_spike",
  "enemy_fed",
  "damage_profile_shift",
  "healing_threat",
  "death_streak",
] as const;
export const CoachTriggerKindSchema = z.enum(COACH_TRIGGER_KINDS);
export type CoachTriggerKind = z.infer<typeof CoachTriggerKindSchema>;

/**
 * The server's own bounds on proactive turns, whatever the client asks:
 * at least 90 seconds between admitted triggers for one owner, and at most 10
 * per game per owner. The same event is admitted once (`ScoutCoachTriggerReceipt`).
 */
export const COACH_PROACTIVE_LIMITS = {
  spacingSeconds: 90,
  perGame: 10,
} as const;

// Every name and count bound is the live snapshot's own, so evidence can hold
// nothing the snapshot could not.
const LiveParticipant = CoachLiveSchema.shape.participants.element;
const Champion = LiveParticipant.shape.champion;
const ItemName = LiveParticipant.shape.items.element.shape.name;
const ItemId = LiveParticipant.shape.items.element.shape.itemId;
const Count = LiveParticipant.shape.kills;
/** Five enemies with a full inventory each. */
const TeamItemCount = z.number().int().min(0).max(35);

export const CoachDamageProfileSchema = z.enum(["physical", "magic", "mixed"]);
export type CoachDamageProfile = z.infer<typeof CoachDamageProfileSchema>;

export const CoachTriggerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("enemy_item_spike"),
    champion: Champion,
    itemId: ItemId,
    itemName: ItemName,
    /** Completed items the enemy holds, this one included. */
    completedItems: z.number().int().min(1).max(7),
  }),
  z.strictObject({
    kind: z.literal("enemy_fed"),
    champion: Champion,
    kills: Count,
    deaths: Count,
    assists: Count,
  }),
  z.strictObject({
    kind: z.literal("damage_profile_shift"),
    from: CoachDamageProfileSchema,
    to: CoachDamageProfileSchema,
    physicalItems: TeamItemCount,
    magicItems: TeamItemCount,
  }),
  z.strictObject({
    kind: z.literal("healing_threat"),
    healingItems: TeamItemCount.min(1),
  }),
  z.strictObject({
    kind: z.literal("death_streak"),
    /** The player's deaths this game. */
    deaths: Count,
    /** Deaths since the player's last kill or assist. */
    deathsWithoutTakedown: z.number().int().min(1).max(255),
  }),
]);
export type CoachTrigger = z.infer<typeof CoachTriggerSchema>;

/**
 * The request. `snapshot` is the `live` section of the coach contract, the
 * frame the detector fired on; `gameKey` is the client's opaque id for the
 * game, which the per-game cap and the dedupe receipts count by.
 */
export const ScoutDesktopCoachTriggerRequestSchema = z.strictObject({
  conversationId: z.uuid().nullable(),
  gameKey: CoachGameKeySchema,
  trigger: CoachTriggerSchema,
  snapshot: CoachLiveSchema,
});
export type ScoutDesktopCoachTriggerRequest = z.infer<
  typeof ScoutDesktopCoachTriggerRequestSchema
>;

/**
 * `started` is a new turn, observed like any run. `duplicate` is an event the
 * server already admitted for this game, so a retry is harmless and starts
 * nothing. Spacing and the per-game cap answer `rate_limited`.
 */
export const ScoutDesktopCoachTriggerResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("started"),
      run: ExploreActiveRunSchema,
    }),
    z.strictObject({ status: z.literal("duplicate") }),
  ],
);
export type ScoutDesktopCoachTriggerResponse = z.infer<
  typeof ScoutDesktopCoachTriggerResponseSchema
>;

/**
 * `coach/triggers/speech` (contract 11): the spoken form of a finished
 * proactive turn's answer, for a beta build whose player has voice
 * conversation mode on and not muted. Beta only, like the trigger itself:
 * production refuses it before the body or any flag is read.
 *
 * The request names a run and nothing else, so no client can choose what is
 * said: the server speaks the saved answer of a finished `app_proactive` turn
 * the calling device started for its own owner. It needs `scout_desktop_voice`
 * and every flag a trigger needs, holds the owner's audio allowance before the
 * speech provider is called, and answers with the speech as ordered PCM
 * chunks in the voice turn's speech format.
 */
export const COACH_PROACTIVE_SPEECH_MAX_CHARACTERS = 600;

/**
 * The most chunks an answer at the character cap can take: speech is held at
 * a deliberately slow 10 characters a second, 100 ms each.
 */
export const COACH_PROACTIVE_SPEECH_MAX_CHUNKS = Math.ceil(
  (COACH_PROACTIVE_SPEECH_MAX_CHARACTERS *
    100 *
    ((SCOUT_DESKTOP_VOICE_TURN.speech.sampleRateHz * 2) / 1000)) /
    SCOUT_DESKTOP_VOICE_TURN.speech.maxChunkBytes,
);

export const ScoutDesktopCoachTriggerSpeechRequestSchema = z.strictObject({
  runId: z.uuid(),
});
export type ScoutDesktopCoachTriggerSpeechRequest = z.infer<
  typeof ScoutDesktopCoachTriggerSpeechRequestSchema
>;

export const ScoutDesktopCoachTriggerSpeechResponseSchema = z.strictObject({
  /** The answer spoken: the proactive turn's saved answer. */
  messageId: z.uuid(),
  /** What was said. */
  spokenText: z.string().min(1).max(COACH_PROACTIVE_SPEECH_MAX_CHARACTERS),
  encoding: z.literal(SCOUT_DESKTOP_VOICE_TURN.speech.encoding),
  sampleRateHz: z.literal(SCOUT_DESKTOP_VOICE_TURN.speech.sampleRateHz),
  /** The speech, in order, each at most `maxChunkBytes` once decoded. */
  chunks: z
    .array(
      z
        .string()
        .min(4)
        .max(4 * Math.ceil(SCOUT_DESKTOP_VOICE_TURN.speech.maxChunkBytes / 3))
        .regex(/^[A-Z0-9+/]+={0,2}$/i),
    )
    .min(1)
    .max(COACH_PROACTIVE_SPEECH_MAX_CHUNKS),
});
export type ScoutDesktopCoachTriggerSpeechResponse = z.infer<
  typeof ScoutDesktopCoachTriggerSpeechResponseSchema
>;
