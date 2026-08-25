import { REPORT_MAX_ROWS_LIMIT } from "@scout-for-lol/data";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import type {
  PlanAggregateRow,
  PlanComparedRow,
  PlanOutputEvidence,
  PlanOutputValue,
} from "#src/reports/plan-rows.ts";
import { planResultColumnNames } from "#src/reports/plan-columns.ts";
import {
  planTemporalGrouping,
  type TemporalContext,
} from "#src/reports/temporal-plan.ts";
import type { TemporalRange } from "#src/reports/temporal-range.ts";
import type {
  ReportMentionIdentity,
  ReportQueryResult,
  ReportResultRow,
  ReportResultValue,
} from "#src/reports/query-types.ts";

/**
 * Post-aggregation: turn executed plan rows into a report result.
 *
 * Ordering, HAVING, LIMIT and every derived value now happen where they
 * belong — in SQL (or, for teammate groups, in the JS evaluator that stands in
 * for it). What is left here is what SQL cannot say: which row can @mention
 * somebody, and how many games back a rendered number.
 */

/** Temporal reports plot many more rows than a table ever shows. */
export const TEMPORAL_ROWS_LIMIT = 2000;

/**
 * The effective row budget for a plan: its own LIMIT, capped by the display
 * budget. A bucketed query is capped far higher because its rows are points on
 * a chart, not lines in a table.
 */
export function effectiveRowLimit(plan: ScoutQlPlan): number {
  const ceiling =
    planTemporalGrouping(plan) === null
      ? REPORT_MAX_ROWS_LIMIT
      : TEMPORAL_ROWS_LIMIT;
  return Math.min(plan.limit, ceiling);
}

export type PlanResultInput = {
  plan: ScoutQlPlan;
  rows: PlanComparedRow[];
  rowsScanned: number;
  /** The range that was executed, which the snapshot buckets against. */
  range: TemporalRange;
  temporal?: TemporalContext | undefined;
};

export function resultFromPlanRows(input: PlanResultInput): ReportQueryResult {
  const { plan } = input;
  return {
    plan,
    columns: planResultColumnNames(plan),
    rows: input.rows.map((entry) =>
      resultRow(plan, entry, input.temporal !== undefined),
    ),
    rowsScanned: input.rowsScanned,
    range: input.range,
    ...(input.temporal === undefined ? {} : { temporal: input.temporal }),
    evidence: input.rows.map((entry) => ({
      label: entry.row.label,
      games: rowGames(entry.row),
      values: entry.row.outputs.map((output) => ({
        column: output.name,
        ...outputEvidence(output.evidence),
      })),
    })),
  };
}

/** Every executed row, with no baseline attached. */
export function withoutComparison(rows: PlanAggregateRow[]): PlanComparedRow[] {
  return rows.map((row) => ({ row, baseline: null }));
}

function resultRow(
  plan: ScoutQlPlan,
  entry: PlanComparedRow,
  hasComparison: boolean,
): ReportResultRow {
  return {
    label: entry.row.label,
    dimensions: entry.row.label.split(" • "),
    keys: entry.row.keys,
    mentionIdentity: mentionIdentity(plan, entry.row),
    values: entry.row.outputs.map((output) =>
      resultValue(plan, output, hasComparison ? entry.baseline : undefined),
    ),
  };
}

function baseResultValue(output: PlanOutputValue): ReportResultValue {
  const evidence = outputEvidence(output.evidence);
  return {
    column: output.name,
    value: output.value,
    sampleSize: evidence.sampleSize,
    games: evidence.sampleSize,
    ...(evidence.successes === undefined
      ? {}
      : { successes: evidence.successes }),
    ...(evidence.numerator === undefined
      ? {}
      : { numerator: evidence.numerator }),
    ...(evidence.denominator === undefined
      ? {}
      : { denominator: evidence.denominator }),
  };
}

/**
 * A baseline of `undefined` means the query asked for no comparison; `null`
 * means it did and the preceding period has no row for this bucket. Those are
 * different answers: the second one is a real zero for an additive output —
 * nothing happened — and unknown for everything else.
 */
function resultValue(
  plan: ScoutQlPlan,
  output: PlanOutputValue,
  baseline: PlanAggregateRow | null | undefined,
): ReportResultValue {
  const base = baseResultValue(output);
  if (baseline === undefined) return base;
  const matched = baseline?.outputs.find(
    (candidate) => candidate.name === output.name,
  );
  const baselineEvidence =
    matched === undefined ? undefined : outputEvidence(matched.evidence);
  const additive =
    plan.outputs.find((candidate) => candidate.name === output.name)
      ?.additive ?? false;
  const baselineValue = matched?.value ?? (additive ? 0 : null);
  const deltas = comparisonDeltasFor(output.value, baselineValue);
  return {
    ...base,
    comparisonValue: baselineValue,
    absoluteDelta: deltas.absolute,
    percentageDelta: deltas.percentage,
    comparisonSampleSize: baselineEvidence?.sampleSize ?? 0,
    comparisonGames: baselineEvidence?.sampleSize ?? 0,
    ...(baselineEvidence?.successes === undefined
      ? {}
      : { comparisonSuccesses: baselineEvidence.successes }),
    ...(baselineEvidence?.numerator === undefined
      ? {}
      : { comparisonNumerator: baselineEvidence.numerator }),
    ...(baselineEvidence?.denominator === undefined
      ? {}
      : { comparisonDenominator: baselineEvidence.denominator }),
  };
}

function comparisonDeltasFor(
  value: number | string | null,
  baseline: number | string | null,
): { absolute: number | null; percentage: number | null } {
  if (typeof value !== "number" || typeof baseline !== "number") {
    return { absolute: null, percentage: null };
  }
  const absolute = value - baseline;
  return {
    absolute,
    percentage: baseline === 0 ? null : absolute / Math.abs(baseline),
  };
}

export type OutputEvidenceSummary = {
  sampleSize: number;
  successes?: number;
  numerator?: number;
  denominator?: number;
};

/**
 * What the compiler's evidence companions mean for the renderer.
 *
 * A rate's sample size is its own trials — under a FILTER those are the
 * filtered counts, which is exactly when a blanket COUNT(*) denominator would
 * be wrong. A ratio has no such trial count; its denominator is its sample:
 * `per_minute(x)` is measured over minutes played, not over games.
 */
function outputEvidence(evidence: PlanOutputEvidence): OutputEvidenceSummary {
  if (evidence.kind === "rate") {
    return {
      sampleSize: evidence.trials,
      successes: evidence.successes,
    };
  }
  if (evidence.kind === "ratio") {
    return {
      sampleSize: evidence.denominator,
      numerator: evidence.numerator,
      denominator: evidence.denominator,
    };
  }
  return { sampleSize: evidence.sampleCount };
}

/**
 * The plain-language game count behind a row.
 *
 * There is no single canonical "games" column in the SQL plan — each output
 * carries its own evidence sample size, scoped to its own FILTER. An output
 * literally named `games` (the convention every migrated and AI-authored
 * query follows) is the row's real, unfiltered game count; failing that, the
 * first output's sample size is the best available stand-in.
 */
function rowGames(row: PlanAggregateRow): number {
  const named = row.outputs.find((output) => output.name === "games");
  const [first] = row.outputs;
  const source = named ?? first;
  return source === undefined ? 0 : outputEvidence(source.evidence).sampleSize;
}

/**
 * A row's @mention identity, or null when the row cannot address anybody.
 *
 * Only a teammate-group row or a single `player` grouping produces one: a row
 * grouped by champion whose label happens to match an alias is a champion.
 * Global-scope player rows carry neither a player id nor a Discord id — there
 * is no accounts join, so the row is a Riot account rather than a tracked
 * player — and an identity there would claim an addressee that does not exist.
 */
function mentionIdentity(
  plan: ScoutQlPlan,
  row: PlanAggregateRow,
): ReportMentionIdentity | null {
  if (row.groupMembers !== null) {
    return { kind: "group", members: row.groupMembers };
  }
  const [only] = plan.groupings;
  if (
    plan.groupings.length !== 1 ||
    only?.kind !== "column" ||
    only.column !== "player"
  ) {
    return null;
  }
  if (row.playerId === null && row.discordId === null) {
    return null;
  }
  return {
    kind: "player",
    playerId: row.playerId,
    alias: row.label,
    discordId: row.discordId,
  };
}
