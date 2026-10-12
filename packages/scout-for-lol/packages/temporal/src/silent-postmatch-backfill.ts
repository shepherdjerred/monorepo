import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { ScoutStageSchema, ScoutWorkflowStatusSchema } from "./contracts.ts";
import { SCOUT_CONTRACT_VERSION } from "./pipeline-contracts.ts";

/**
 * The silent post-match backfill: render and attest a match's post-match
 * report for a match the V2 core finished WITHOUT ever minting its report
 * intents, and announce nothing.
 *
 * It exists for one gap. A V2 core build ran without the intent mint, so the
 * matches it processed committed every domain fact — archive, observation,
 * settlement, progression, tournament, cursor — and then had no postmatch
 * intent to fan out a notification from. With no intent there was no
 * notification child, and with no child there was no render: the report image
 * a normal run commits to the object store, and the render receipt that
 * attests to it, were never produced.
 *
 * ## What it produces, and what it never can
 *
 * Exactly what a normal run's render produces for the match, through the same
 * fenced render and under the same receipt: the report image (and the AI
 * review image, when the match earns one) in the canonical store, and one
 * `v2-notification-render-postmatch` receipt naming those bytes.
 *
 * It mints no notification intent and makes no Discord call. That is not a
 * mode of a shared path. The Workflow proxies ONE Activity, whose type
 * admits nothing else, and the backend implementation of that Activity
 * imports neither the minter nor the delivery. Nothing the backfill runs has
 * the means to produce an announcement, so there is no flag whose value could
 * make it announce one.
 *
 * A match the backfill declines is reported with the reason, never rendered:
 * one another pipeline owns, one the core has not finished, one observed as
 * `silent-backfill` (a normal run renders nothing for it either), one that
 * already carries a postmatch intent (the live lane owns its render), and one
 * with no deliverable channel (a normal run minted nothing, so rendered
 * nothing).
 */

/**
 * Why a match was left alone. Each is a fact the backend read, not a failure:
 * a rerun over the same list reads the same facts and declines the same way.
 */
export const ScoutSilentBackfillSkipReasonSchema = z.enum([
  "already-rendered",
  "not-v2-owned",
  "archive-only",
  "observed-silent",
  "core-incomplete",
  "postmatch-intent-standing",
  "no-deliverable-channel",
]);
export type ScoutSilentBackfillSkipReason = z.infer<
  typeof ScoutSilentBackfillSkipReasonSchema
>;

/**
 * One match's backfill, as the Activity reports it. `rendered` committed the
 * artifact and its receipt; `reused` found that another render committed it
 * first, under the shared fence.
 */
export const ScoutSilentPostmatchBackfillResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({ outcome: z.literal("rendered") }),
    z.strictObject({ outcome: z.literal("reused") }),
    z.strictObject({
      outcome: z.literal("skipped"),
      reason: ScoutSilentBackfillSkipReasonSchema,
    }),
  ],
);
export type ScoutSilentPostmatchBackfillResult = z.infer<
  typeof ScoutSilentPostmatchBackfillResultSchema
>;

/**
 * The most matches one execution takes. The gap is under two hundred; the
 * bound keeps an execution's history and its result payload small rather than
 * sizing a batch to a list nobody has yet.
 */
export const SCOUT_SILENT_BACKFILL_MAX_MATCHES = 500;

/**
 * How many matches render at once. Each render is a Satori pass, a PNG encode
 * and possibly an AI review, on the background queue v1's slow jobs and the
 * live renders share; two keeps the backfill from crowding either.
 */
export const SCOUT_SILENT_BACKFILL_CONCURRENCY = 2;

export const ScoutSilentPostmatchBackfillInputSchema = z
  .strictObject({
    stage: ScoutStageSchema,
    riotMatchIds: z
      .array(RiotMatchIdSchema)
      .min(1)
      .max(SCOUT_SILENT_BACKFILL_MAX_MATCHES)
      .readonly(),
  })
  .refine(
    (input) => new Set(input.riotMatchIds).size === input.riotMatchIds.length,
    { message: "riotMatchIds must not repeat a match", path: ["riotMatchIds"] },
  );
export type ScoutSilentPostmatchBackfillInput = z.infer<
  typeof ScoutSilentPostmatchBackfillInputSchema
>;

export const ScoutSilentBackfillMatchOutcomeSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({
      riotMatchId: RiotMatchIdSchema,
      outcome: z.enum(["rendered", "reused"]),
    }),
    z.strictObject({
      riotMatchId: RiotMatchIdSchema,
      outcome: z.literal("skipped"),
      reason: ScoutSilentBackfillSkipReasonSchema,
    }),
    z.strictObject({
      riotMatchId: RiotMatchIdSchema,
      outcome: z.literal("failed"),
      message: z.string(),
    }),
  ],
);
export type ScoutSilentBackfillMatchOutcome = z.infer<
  typeof ScoutSilentBackfillMatchOutcomeSchema
>;

export const ScoutSilentPostmatchBackfillSummarySchema = z.strictObject({
  status: ScoutWorkflowStatusSchema,
  requested: z.int().nonnegative(),
  rendered: z.int().nonnegative(),
  reused: z.int().nonnegative(),
  skipped: z.int().nonnegative(),
  failed: z.int().nonnegative(),
  /** Every requested match, in request order. */
  outcomes: z.array(ScoutSilentBackfillMatchOutcomeSchema).readonly(),
});
export type ScoutSilentPostmatchBackfillSummary = z.infer<
  typeof ScoutSilentPostmatchBackfillSummarySchema
>;

export const scoutSilentPostmatchBackfillInputCodec = defineVersionedCodec({
  kind: "scout-silent-postmatch-backfill-v2-input",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutSilentPostmatchBackfillInputSchema,
});
export const scoutSilentPostmatchBackfillResultCodec = defineVersionedCodec({
  kind: "scout-silent-postmatch-backfill-v2-result",
  version: SCOUT_CONTRACT_VERSION,
  schema: ScoutSilentPostmatchBackfillSummarySchema,
});

export type ScoutSilentPostmatchBackfillInputEnvelope = ReturnType<
  typeof scoutSilentPostmatchBackfillInputCodec.serialize
>;
export type ScoutSilentPostmatchBackfillResultEnvelope = ReturnType<
  typeof scoutSilentPostmatchBackfillResultCodec.serialize
>;
