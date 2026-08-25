import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  formatISO,
  parseISO,
} from "date-fns";
import type { LakeScalar } from "#src/reports/duckdb/row-schema.ts";
import {
  comparePatchLabels,
  localCalendarDate,
} from "#src/reports/temporal-labels.ts";
import type {
  PlanAggregateRow,
  PlanComparedRow,
} from "#src/reports/plan-rows.ts";
import type { TemporalContext } from "#src/reports/temporal-plan.ts";
import type { TemporalRange } from "#src/reports/temporal-range.ts";

/**
 * Pair each current-period row with the same bucket of the preceding period.
 *
 * The pairing keys off the plan's typed grouping keys, not the rendered label.
 * A label is a display string — "2026-05-04" and "2026-04-27" are the same
 * bucket one period apart and would never match as text — so the two periods
 * are aligned by BUCKET OFFSET from their own range start, and the remaining
 * groupings (player, champion, …) must match exactly.
 *
 * A baseline bucket the current period has no row for is materialized as an
 * empty current row, so the comparison series still shows what the previous
 * period did there rather than dropping the bucket entirely.
 */

export type TemporalMergeInput = {
  plan: ScoutQlPlan;
  context: TemporalContext;
  current: PlanAggregateRow[];
  comparison: PlanAggregateRow[];
};

export function mergeTemporalPeriods(
  input: TemporalMergeInput,
): PlanComparedRow[] {
  const { plan, context } = input;
  const currentPatches = orderedPatchKeys(input.current, context);
  const comparisonPatches = orderedPatchKeys(input.comparison, context);
  const currentSeries = groupBySeries(input.current, context);
  const comparisonSeries = groupBySeries(input.comparison, context);

  const merged: PlanComparedRow[] = [];
  const seriesKeys = new Set([
    ...currentSeries.keys(),
    ...comparisonSeries.keys(),
  ]);
  for (const seriesKey of seriesKeys) {
    const byOffset = offsetMap(
      currentSeries.get(seriesKey) ?? [],
      context,
      context.ranges.current,
      currentPatches,
    );
    const baselineByOffset = offsetMap(
      comparisonSeries.get(seriesKey) ?? [],
      context,
      context.ranges.comparison,
      comparisonPatches,
    );
    for (const [offset, baseline] of baselineByOffset) {
      if (byOffset.has(offset)) continue;
      const materialized = materializeMissingRow({
        plan,
        context,
        baseline,
        offset,
        patchKeys: currentPatches,
      });
      if (materialized !== null) {
        byOffset.set(offset, materialized);
      }
    }
    for (const [offset, row] of byOffset) {
      merged.push({ row, baseline: baselineByOffset.get(offset) ?? null });
    }
  }
  return merged;
}

/** Every grouping key except the temporal one, joined into a series key. */
function seriesKeyOf(row: PlanAggregateRow, context: TemporalContext): string {
  return row.keys
    .filter((_, index) => index !== context.groupingIndex)
    .map(String)
    .join("\u{0}");
}

function groupBySeries(
  rows: PlanAggregateRow[],
  context: TemporalContext,
): Map<string, PlanAggregateRow[]> {
  const groups = new Map<string, PlanAggregateRow[]>();
  for (const row of rows) {
    const key = seriesKeyOf(row, context);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function temporalKey(row: PlanAggregateRow, context: TemporalContext): string {
  const key = row.keys[context.groupingIndex];
  if (key === null || key === undefined) {
    throw new Error(
      "A comparison row is missing its time bucket — the bucket grouping produced no key.",
    );
  }
  return String(key);
}

/** Patch buckets have no calendar arithmetic; their order within a period is
 * the offset, exactly as the legacy engine aligned them. */
function orderedPatchKeys(
  rows: PlanAggregateRow[],
  context: TemporalContext,
): string[] {
  if (context.bucket !== "patch") return [];
  return [...new Set(rows.map((row) => temporalKey(row, context)))].toSorted(
    comparePatchLabels,
  );
}

function offsetMap(
  rows: PlanAggregateRow[],
  context: TemporalContext,
  range: TemporalRange,
  patchKeys: string[],
): Map<number, PlanAggregateRow> {
  const byOffset = new Map<number, PlanAggregateRow>();
  for (const row of rows) {
    byOffset.set(bucketOffset(row, context, range, patchKeys), row);
  }
  return byOffset;
}

function bucketOffset(
  row: PlanAggregateRow,
  context: TemporalContext,
  range: TemporalRange,
  patchKeys: string[],
): number {
  const key = temporalKey(row, context);
  if (context.bucket === "patch") {
    const index = patchKeys.indexOf(key);
    if (index === -1) {
      throw new Error(`Patch bucket "${key}" is missing from its period.`);
    }
    return index;
  }
  const anchor = rangeBucketStart(range, context);
  const bucketDate = parseISO(bucketDatePart(key, context.bucket));
  if (context.bucket === "month") {
    return differenceInCalendarMonths(bucketDate, anchor);
  }
  const days = differenceInCalendarDays(bucketDate, anchor);
  return context.bucket === "day" ? days : Math.floor(days / 7);
}

/**
 * A DATE_TRUNC key arrives as an ISO timestamp whose date part IS the local
 * bucket start — the compiler truncates in the grouping's timezone before
 * DuckDB serializes it — so only the date part participates in the offset.
 */
function bucketDatePart(key: string, bucket: "day" | "week" | "month"): string {
  const date = key.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new Error(`Time bucket "${key}" is not a date.`);
  }
  return bucket === "month" ? `${date.slice(0, 7)}-01` : date;
}

function rangeBucketStart(
  range: TemporalRange,
  context: TemporalContext,
): Date {
  const local = localCalendarDate(range.startDate, context.timezone);
  const parsed = parseISO(
    context.bucket === "month" ? `${local.slice(0, 7)}-01` : local,
  );
  // DuckDB's date_trunc('week', …) is Monday-based; align the anchor to match.
  return context.bucket === "week"
    ? addDays(parsed, -((parsed.getDay() + 6) % 7))
    : parsed;
}

type MissingRowInput = {
  plan: ScoutQlPlan;
  context: TemporalContext;
  baseline: PlanAggregateRow;
  offset: number;
  patchKeys: string[];
};

/**
 * The current period's empty counterpart of a baseline bucket. Additive
 * outputs read zero (nothing happened), everything else reads null (there is
 * no average of no games).
 */
function materializeMissingRow(
  input: MissingRowInput,
): PlanAggregateRow | null {
  const key = currentBucketKey(input);
  if (key === null) return null;
  const keys = input.baseline.keys.map((existing, index) =>
    index === input.context.groupingIndex ? key.key : existing,
  );
  const labelParts = input.baseline.label.split(" • ");
  const label =
    labelParts.length === input.baseline.keys.length
      ? labelParts
          .map((part, index) =>
            index === input.context.groupingIndex ? key.label : part,
          )
          .join(" • ")
      : key.label;
  return {
    label,
    playerId: input.baseline.playerId,
    discordId: input.baseline.discordId,
    keys,
    groupMembers: input.baseline.groupMembers,
    outputs: input.plan.outputs.map((output) => ({
      name: output.name,
      value: output.additive ? 0 : null,
      evidence: emptyEvidence(output.evidence.kind),
    })),
  };
}

function emptyEvidence(
  kind: ScoutQlPlan["outputs"][number]["evidence"]["kind"],
): PlanAggregateRow["outputs"][number]["evidence"] {
  if (kind === "rate") return { kind: "rate", successes: 0, trials: 0 };
  if (kind === "ratio") return { kind: "ratio", numerator: 0, denominator: 0 };
  return { kind: "sample", sampleCount: 0 };
}

/**
 * The key and label the current period would have used at this offset. Patch
 * buckets can only borrow a patch the current period actually saw; there is no
 * arithmetic that invents the next patch number.
 */
function currentBucketKey(
  input: MissingRowInput,
): { key: LakeScalar; label: string } | null {
  const { context, offset } = input;
  if (context.bucket === "patch") {
    const patch = input.patchKeys[offset];
    return patch === undefined ? null : { key: patch, label: patch };
  }
  const anchor = rangeBucketStart(context.ranges.current, context);
  const date =
    context.bucket === "month"
      ? addMonths(anchor, offset)
      : context.bucket === "week"
        ? addWeeks(anchor, offset)
        : addDays(anchor, offset);
  const iso = formatISO(date, { representation: "date" });
  return {
    key: `${iso}T00:00:00.000Z`,
    label: context.bucket === "month" ? iso.slice(0, 7) : iso,
  };
}
