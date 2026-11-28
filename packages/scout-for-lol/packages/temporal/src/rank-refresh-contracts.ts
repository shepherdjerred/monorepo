import { z } from "zod";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { ScoutStageSchema } from "./contracts.ts";

/**
 * Batches one rank-refresh run issues at most. The Schedule runs daily, so a
 * roster larger than this finishes on the next run, and one run's history
 * stays small.
 */
export const RANK_REFRESH_MAX_BATCHES = 20;

/**
 * Players Riot permanently rejected that one run carries between batches, and
 * so the most it can name. Past this the run fails at once rather than
 * growing its history.
 */
export const RANK_REFRESH_MAX_PERMANENT_FAILURES = 100;

/** PUUID characters a failure names: enough to find the player, not to identify them. */
export const RANK_REFRESH_PUUID_PREFIX_LENGTH = 8;

export const ScoutRankRefreshInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  trigger: z.literal("schedule"),
});
export type ScoutRankRefreshInput = z.infer<typeof ScoutRankRefreshInputSchema>;

/** One Activity call: the run's input plus the players an earlier batch of this run found permanently rejected. */
export const ScoutRankRefreshBatchInputSchema =
  ScoutRankRefreshInputSchema.extend({
    excluded: z
      .array(LeaguePuuidSchema)
      .max(RANK_REFRESH_MAX_PERMANENT_FAILURES),
  });
export type ScoutRankRefreshBatchInput = z.infer<
  typeof ScoutRankRefreshBatchInputSchema
>;

/** A player Riot rejected with a status that retrying cannot change. */
export const ScoutRankRefreshPermanentFailureSchema = z.strictObject({
  puuid: LeaguePuuidSchema,
  status: z.number().int(),
});
export type ScoutRankRefreshPermanentFailure = z.infer<
  typeof ScoutRankRefreshPermanentFailureSchema
>;

/**
 * One bounded batch of tracked players with no rank evidence in the last seven
 * days: how many got a rank, how many are unranked, the players Riot
 * permanently rejected, and whether more are due. `enabled: false` is the kill
 * switch answering, with every count zero.
 */
export const ScoutRankRefreshBatchResultSchema = z.strictObject({
  enabled: z.boolean(),
  refreshed: z.number().int().nonnegative(),
  unranked: z.number().int().nonnegative(),
  failed: z.array(ScoutRankRefreshPermanentFailureSchema),
  more: z.boolean(),
});
export type ScoutRankRefreshBatchResult = z.infer<
  typeof ScoutRankRefreshBatchResultSchema
>;

/** One Workflow run: its batches, the players they covered, and whether nobody is left due. */
export const ScoutRankRefreshResultSchema = z.strictObject({
  enabled: z.boolean(),
  batches: z.number().int().positive(),
  refreshed: z.number().int().nonnegative(),
  unranked: z.number().int().nonnegative(),
  drained: z.boolean(),
});
export type ScoutRankRefreshResult = z.infer<
  typeof ScoutRankRefreshResultSchema
>;
