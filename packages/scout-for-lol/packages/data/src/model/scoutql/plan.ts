import { z } from "zod";
import {
  DEFAULT_RENDER_SPEC,
  ReportDisplayKindSchema,
  ReportRenderSpecSchema,
  type ReportRenderSpec,
} from "#src/model/report.ts";
import {
  ScoutQlEvidenceSchema,
  ScoutQlOutputNameSchema,
  ScoutQlPredicateSchema,
  ScoutQlScalarExprSchema,
  ScoutQlAggregateExprSchema,
  ScoutQlHavingPredicateSchema,
  type ScoutQlHavingPredicate,
  type ScoutQlAggregateExpr,
  type ScoutQlPredicate,
} from "#src/model/scoutql/expression.ts";

// ── ScoutQL v2 plan ──────────────────────────────────────────────────────────
// The compiled form of a ScoutQL query — what the engine executes. Expression
// trees live in scoutql/expression.ts; this module assembles them into the
// whole-query shape plus its cross-field rules. Two plan-level invariants:
//
// - `player('…')` stays an unresolved name in `playerRefs` (never a PUUID);
//   predicate trees reference it by index. Macros (`kda()`, `per_minute()`,
//   `champion('…')`) are expanded before the plan exists — the engine sees
//   only the core vocabulary.
// - Recognized top-level time conjuncts are HOISTED out of `where` into
//   `timeWindow`. The window must be a substitution point, not another
//   predicate: competition ranges and `compare = previous_period` replace the
//   range, and an inline predicate could only intersect (previous period ∩
//   last 30 days = ∅).

export type ScoutQlSource = z.infer<typeof ScoutQlSourceSchema>;
export const ScoutQlSourceSchema = z.enum([
  "match_participants",
  "prematch_participants",
  "player_groups",
  "rank_current",
  "competition_match_participants",
  "competition_rank",
]);

// ── Outputs ──────────────────────────────────────────────────────────────────

/**
 * An output is an aggregate expression, or an echo of a grouping (`SELECT
 * week, COUNT(*) …` — `week` echoes groupings[i]). Echoes carry the grouping's
 * index so the engine reads the value from the grouping key it already emits.
 */
export type ScoutQlOutputExpr =
  ScoutQlAggregateExpr | { kind: "grouping-ref"; index: number };

export const ScoutQlOutputExprSchema: z.ZodType<ScoutQlOutputExpr> = z.union([
  z.object({
    kind: z.literal("grouping-ref"),
    index: z.number().int().nonnegative(),
  }),
  ScoutQlAggregateExprSchema,
]);

export type ScoutQlOutput = z.infer<typeof ScoutQlOutputSchema>;
export const ScoutQlOutputSchema = z.object({
  name: ScoutQlOutputNameSchema,
  expr: ScoutQlOutputExprSchema,
  displayKind: ReportDisplayKindSchema,
  /** SUM/COUNT-shaped (safe to accumulate); feeds cumulative-render checks. */
  additive: z.boolean(),
  evidence: ScoutQlEvidenceSchema,
});

// ── Groupings ────────────────────────────────────────────────────────────────

export type ScoutQlGroupSize = z.infer<typeof ScoutQlGroupSizeSchema>;
export const ScoutQlGroupSizeSchema = z.union([
  z.number().int().min(2).max(5),
  z.literal("all"),
]);

export type ScoutQlGrouping = z.infer<typeof ScoutQlGroupingSchema>;
export const ScoutQlGroupingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("column"),
    column: z.string().min(1),
    name: ScoutQlOutputNameSchema,
  }),
  z.object({
    kind: z.literal("date-trunc"),
    part: z.enum(["day", "week", "month"]),
    column: z.string().min(1),
    /** IANA zone the bucket boundaries are computed in; "UTC" when unstated. */
    timezone: z.string().min(1),
    name: ScoutQlOutputNameSchema,
  }),
  z.object({
    kind: z.literal("expression"),
    expr: ScoutQlScalarExprSchema,
    name: ScoutQlOutputNameSchema,
  }),
  z.object({
    kind: z.literal("group"),
    size: ScoutQlGroupSizeSchema,
    name: ScoutQlOutputNameSchema,
  }),
]);

// ── Time window ──────────────────────────────────────────────────────────────
// The structural summary of the recognized top-level time conjuncts, hoisted
// out of `where`. `bounded` = a time predicate exists but is not a recognized
// shape (it stays in `where`; execution range falls back to all history).
// `unbounded` = no time conjunct at all — legal, linted. `snapshot` = the
// source has no time column (rank snapshots).

export type ScoutQlTimeWindow = z.infer<typeof ScoutQlTimeWindowSchema>;
export const ScoutQlTimeWindowSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("relative"),
    amount: z.number().int().positive(),
    unit: z.enum(["day", "week", "month", "year"]),
  }),
  z.object({
    kind: z.literal("calendar"),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    timezone: z.string().min(1),
  }),
  z.object({ kind: z.literal("bounded") }),
  z.object({ kind: z.literal("unbounded") }),
  z.object({ kind: z.literal("snapshot") }),
]);

// ── Ordering ─────────────────────────────────────────────────────────────────

export type ScoutQlOrderKey = z.infer<typeof ScoutQlOrderKeySchema>;
export const ScoutQlOrderKeySchema = z.object({
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("output"), name: ScoutQlOutputNameSchema }),
    z.object({
      kind: z.literal("grouping"),
      index: z.number().int().nonnegative(),
    }),
  ]),
  direction: z.enum(["asc", "desc"]),
});

// ── The plan ─────────────────────────────────────────────────────────────────

const COMPETITION_SOURCES: ReadonlySet<ScoutQlSource> = new Set<ScoutQlSource>([
  "competition_match_participants",
  "competition_rank",
]);
const SNAPSHOT_SOURCES: ReadonlySet<ScoutQlSource> = new Set<ScoutQlSource>([
  "rank_current",
  "competition_rank",
]);

export type ScoutQlPlan = {
  source: ScoutQlSource;
  outputs: ScoutQlOutput[];
  where?: ScoutQlPredicate | undefined;
  timeWindow: ScoutQlTimeWindow;
  /** Empty = grand total (no GROUP BY, all outputs aggregate). */
  groupings: ScoutQlGrouping[];
  having?: ScoutQlHavingPredicate | undefined;
  orderBy: ScoutQlOrderKey[];
  limit: number;
  /** Unresolved `player('…')` names — never PUUIDs. */
  playerRefs: string[];
  competitionId?: number | undefined;
  render: ReportRenderSpec;
};

function collectPlayerRefIndexes(
  predicate: ScoutQlPredicate,
  into: number[],
): void {
  if (predicate.kind === "and" || predicate.kind === "or") {
    for (const operand of predicate.operands) {
      collectPlayerRefIndexes(operand, into);
    }
    return;
  }
  if (predicate.kind === "not") {
    collectPlayerRefIndexes(predicate.operand, into);
    return;
  }
  if (predicate.kind === "player-ref") {
    into.push(predicate.index);
  }
}

export const ScoutQlPlanSchema: z.ZodType<ScoutQlPlan> = z
  .object({
    source: ScoutQlSourceSchema,
    outputs: z.array(ScoutQlOutputSchema).min(1).max(20),
    where: ScoutQlPredicateSchema.optional(),
    timeWindow: ScoutQlTimeWindowSchema,
    groupings: z.array(ScoutQlGroupingSchema).max(3),
    having: ScoutQlHavingPredicateSchema.optional(),
    orderBy: z.array(ScoutQlOrderKeySchema).max(3),
    limit: z.number().int().positive(),
    playerRefs: z.array(z.string().min(1)),
    competitionId: z.number().int().positive().optional(),
    render: ReportRenderSpecSchema.default(DEFAULT_RENDER_SPEC),
  })
  .superRefine((plan, ctx) => {
    const outputNames = new Set(plan.outputs.map((output) => output.name));
    if (outputNames.size !== plan.outputs.length) {
      ctx.addIssue({
        code: "custom",
        path: ["outputs"],
        message: "Output names must be unique.",
      });
    }
    plan.outputs.forEach((output, index) => {
      if (output.expr.kind !== "grouping-ref") return;
      const grouping = plan.groupings[output.expr.index];
      if (grouping === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["outputs", index],
          message: `Output "${output.name}" references grouping ${output.expr.index.toString()}, which does not exist.`,
        });
      } else if (grouping.name !== output.name) {
        ctx.addIssue({
          code: "custom",
          path: ["outputs", index],
          message: `Grouping echo "${output.name}" must use the grouping's name "${grouping.name}".`,
        });
      }
    });
    for (const [index, key] of plan.orderBy.entries()) {
      if (key.target.kind === "output" && !outputNames.has(key.target.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["orderBy", index],
          message: `ORDER BY target "${key.target.name}" is not an output.`,
        });
      }
      if (
        key.target.kind === "grouping" &&
        plan.groupings[key.target.index] === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["orderBy", index],
          message: "ORDER BY grouping index out of range.",
        });
      }
    }
    const groupGroupings = plan.groupings.filter(
      (grouping) => grouping.kind === "group",
    );
    if (groupGroupings.length > 0) {
      if (plan.source !== "player_groups") {
        ctx.addIssue({
          code: "custom",
          path: ["groupings"],
          message: "GROUP BY group(...) is only valid for player_groups.",
        });
      }
      if (plan.groupings.length !== 1) {
        ctx.addIssue({
          code: "custom",
          path: ["groupings"],
          message: "group(...) cannot be combined with another grouping.",
        });
      }
    } else if (plan.source === "player_groups") {
      ctx.addIssue({
        code: "custom",
        path: ["groupings"],
        message: "player_groups requires GROUP BY group(...).",
      });
    }
    if (
      COMPETITION_SOURCES.has(plan.source) &&
      plan.competitionId === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["competitionId"],
        message: `${plan.source} requires a competition_id filter.`,
      });
    }
    if (
      !COMPETITION_SOURCES.has(plan.source) &&
      plan.competitionId !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["competitionId"],
        message: `competition_id is not valid for ${plan.source}.`,
      });
    }
    const snapshotWindow = plan.timeWindow.kind === "snapshot";
    if (snapshotWindow !== SNAPSHOT_SOURCES.has(plan.source)) {
      ctx.addIssue({
        code: "custom",
        path: ["timeWindow"],
        message: snapshotWindow
          ? `${plan.source} is not a snapshot source.`
          : `${plan.source} is a snapshot source; its window must be "snapshot".`,
      });
    }
    if (plan.where !== undefined) {
      const indexes: number[] = [];
      collectPlayerRefIndexes(plan.where, indexes);
      for (const index of indexes) {
        if (index >= plan.playerRefs.length) {
          ctx.addIssue({
            code: "custom",
            path: ["playerRefs"],
            message: "player('…') reference index out of range.",
          });
        }
      }
    }
  });

/**
 * Parse an assembled plan, turning a schema failure into a readable sentence.
 * Query-text paths are all diagnosed upstream with their own messages, so a
 * failure here means a hand-built plan or a new schema rule — but the result
 * still reaches operators and AI authors via `validate_report_query`, and a
 * raw ZodError dump is not something either can act on.
 */
export function parseScoutQlPlan(candidate: unknown): ScoutQlPlan {
  const result = ScoutQlPlanSchema.safeParse(candidate);
  if (result.success) {
    return result.data;
  }
  const detail = result.error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
  throw new Error(`Invalid ScoutQL plan. ${detail}`);
}
