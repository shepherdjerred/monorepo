import { z } from "zod";

// ── Report query language: schema enums + query plan ─────────────────────────
// Single source of truth for the bespoke SQL-like report query language. Shared
// by the backend (execution) and the web app (Monaco editor, docs). Kept pure
// (zod only) so it is safe to bundle into the browser.

export type ReportSource = z.infer<typeof ReportSourceSchema>;
export const ReportSourceSchema = z.enum([
  "match_participants",
  "prematch_participants",
  "player_pairs",
  "rank_current",
  "competition_match_participants",
  "competition_rank",
]);

export type ReportGroupBy = z.infer<typeof ReportGroupBySchema>;
export const ReportGroupBySchema = z.enum([
  "player",
  "champion",
  "queue",
  "pair",
]);

export type ReportMetric = z.infer<typeof ReportMetricSchema>;
export const ReportMetricSchema = z.enum([
  "games",
  "wins",
  "losses",
  "surrenders",
  "surrender_rate",
  "win_rate",
  "kills",
  "deaths",
  "assists",
  "kda",
  "creep_score",
  "damage_to_champions",
  "prematches",
  "score",
]);

export type ReportOrderDirection = z.infer<typeof ReportOrderDirectionSchema>;
export const ReportOrderDirectionSchema = z.enum(["asc", "desc"]);

export type ReportQueryPlan = z.infer<typeof ReportQueryPlanSchema>;
export const ReportQueryPlanSchema = z.object({
  source: ReportSourceSchema,
  groupBy: ReportGroupBySchema,
  metrics: z.array(ReportMetricSchema).min(1),
  queueFilter: z.array(z.string().min(1)).optional(),
  championId: z.number().int().positive().optional(),
  minGames: z.number().int().positive().optional(),
  competitionId: z.number().int().positive().optional(),
  orderBy: z.union([ReportMetricSchema, z.literal("label")]).default("games"),
  orderDirection: ReportOrderDirectionSchema.default("desc"),
  limit: z.number().int().positive().optional(),
});

// The order-by target is any metric, or the special "label" grouping column.
export type ReportOrderBy = z.infer<typeof ReportOrderBySchema>;
export const ReportOrderBySchema = z.union([
  ReportMetricSchema,
  z.literal("label"),
]);
