import { z } from "zod";
import {
  DEFAULT_RENDER_SPEC,
  ReportRenderSpecSchema,
} from "#src/model/report.ts";

// ── Report query language: schema enums + query plan ─────────────────────────
// Single source of truth for the bespoke SQL-like report query language. Shared
// by the backend (execution) and the web app (Monaco editor, docs). Kept pure
// (zod only) so it is safe to bundle into the browser.

export type ReportSource = z.infer<typeof ReportSourceSchema>;
export const ReportSourceSchema = z.enum([
  "match_participants",
  "prematch_participants",
  // Canonical id for teammate-group reports. `player_pairs` is the legacy
  // alias; the compiler normalizes it to `player_groups`.
  "player_groups",
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
  // Teammate groups: `GROUP BY group(N)` / `group(all)`. The group size lives
  // in ReportQueryPlan.groupSize; `pair` is the legacy alias for group(2).
  "group",
]);

// Requested teammate-group size: a fixed size (2-5 — bounded by a 5v5 roster)
// or "all" for every size the roster supports (2..teamSize per group unit).
export type ReportGroupSize = z.infer<typeof ReportGroupSizeSchema>;
export const ReportGroupSizeSchema = z.union([
  z.number().int().min(2).max(5),
  z.literal("all"),
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
  "gold_earned",
  "vision_score",
  "damage_taken",
  "total_damage_dealt",
  "wards_placed",
  "multikills",
  "avg_game_duration",
  "cs_per_minute",
  "prematches",
  "score",
]);

export type ReportOrderDirection = z.infer<typeof ReportOrderDirectionSchema>;
export const ReportOrderDirectionSchema = z.enum(["asc", "desc"]);

export type ReportQueryPlan = z.infer<typeof ReportQueryPlanSchema>;
export const ReportQueryPlanSchema = z
  .object({
    source: ReportSourceSchema,
    groupBy: ReportGroupBySchema,
    // Required iff groupBy === "group" (enforced by the superRefine below).
    groupSize: ReportGroupSizeSchema.optional(),
    metrics: z.array(ReportMetricSchema).min(1),
    queueFilter: z.array(z.string().min(1)).optional(),
    championId: z.number().int().positive().optional(),
    minGames: z.number().int().positive().optional(),
    competitionId: z.number().int().positive().optional(),
    orderBy: z.union([ReportMetricSchema, z.literal("label")]).default("games"),
    orderDirection: ReportOrderDirectionSchema.default("desc"),
    limit: z.number().int().positive().optional(),
    // The trailing `RENDER <kind> [WITH (...)]` clause; absent clauses default to
    // a TABLE render so a plain query reproduces the pre-DSL behavior.
    render: ReportRenderSpecSchema.default(DEFAULT_RENDER_SPEC),
  })
  .superRefine((plan, ctx) => {
    if (plan.groupBy === "group" && plan.groupSize === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["groupSize"],
        message: "GROUP BY group requires a size: group(2..5) or group(all).",
      });
    }
    if (plan.groupBy !== "group" && plan.groupSize !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["groupSize"],
        message: "groupSize is only valid with GROUP BY group(...).",
      });
    }
  });

// The order-by target is any metric, or the special "label" grouping column.
export type ReportOrderBy = z.infer<typeof ReportOrderBySchema>;
export const ReportOrderBySchema = z.union([
  ReportMetricSchema,
  z.literal("label"),
]);

// ── Editor-facing AST + diagnostics ──────────────────────────────────────────
// The parser produces a lenient AST (raw lowercased values + source spans) plus
// diagnostics, so the Monaco editor can show squiggles and the executor can
// compile a strict ReportQueryPlan from the same parse.

// Half-open character offset range [start, end) into the original query text.
export type ReportQuerySpan = { start: number; end: number };

export type ReportDiagnosticSeverity = z.infer<
  typeof ReportDiagnosticSeveritySchema
>;
export const ReportDiagnosticSeveritySchema = z.enum([
  "error",
  "warning",
  "info",
]);

export type ReportDiagnostic = {
  message: string;
  severity: ReportDiagnosticSeverity;
  span: ReportQuerySpan;
};

export type ReportQueryItem = { value: string; span: ReportQuerySpan };

export type ReportWhereClause =
  | { kind: "queue"; values: string[]; span: ReportQuerySpan }
  | { kind: "champion_id"; value: number; span: ReportQuerySpan }
  | { kind: "min_games"; value: number; span: ReportQuerySpan }
  | { kind: "competition_id"; value: number; span: ReportQuerySpan }
  | { kind: "unsupported"; text: string; span: ReportQuerySpan };

export type ReportQueryOrderBy = {
  metric: ReportQueryItem;
  direction?: ReportQueryItem | undefined;
};

export type ReportQueryAst = {
  select: ReportQueryItem[];
  source?: ReportQueryItem | undefined;
  where: ReportWhereClause[];
  groupBy?: ReportQueryItem | undefined;
  orderBy?: ReportQueryOrderBy | undefined;
  limit?: ReportQueryItem | undefined;
  // Raw text of the trailing RENDER clause (the part after the `RENDER` keyword,
  // e.g. `bar_chart with (y = win_rate)`); compiled to a ReportRenderSpec.
  render?: ReportQueryItem | undefined;
};

export type ReportParseResult = {
  ast: ReportQueryAst;
  diagnostics: ReportDiagnostic[];
};
