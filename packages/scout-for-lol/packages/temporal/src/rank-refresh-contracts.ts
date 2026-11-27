import { z } from "zod";
import { ScoutStageSchema } from "./contracts.ts";

/**
 * Batches one rank-refresh run issues at most. The Schedule runs daily, so a
 * roster larger than this finishes on the next run, and one run's history
 * stays small.
 */
export const RANK_REFRESH_MAX_BATCHES = 20;

export const ScoutRankRefreshInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  trigger: z.literal("schedule"),
});
export type ScoutRankRefreshInput = z.infer<typeof ScoutRankRefreshInputSchema>;

/**
 * One bounded batch of tracked players with no rank evidence in the last seven
 * days: how many got a rank, how many are unranked, and whether more are due.
 * `enabled: false` is the kill switch answering, with every count zero.
 */
export const ScoutRankRefreshBatchResultSchema = z.strictObject({
  enabled: z.boolean(),
  refreshed: z.number().int().nonnegative(),
  unranked: z.number().int().nonnegative(),
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
