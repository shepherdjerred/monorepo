import type {
  ResolvedTemporalBucket,
  TemporalSeriesPoint,
} from "@scout-for-lol/data";
import type {
  ScoutQlPlan,
  ScoutQlGrouping,
} from "@scout-for-lol/data/model/scoutql/plan.ts";
import type { ScoutQlScalarExpr } from "@scout-for-lol/data/model/scoutql/expression.ts";
import { addDays, addMonths, addWeeks, formatISO, parseISO } from "date-fns";
import type {
  ReportQueryResult,
  ReportResultRow,
  ReportResultValue,
} from "#src/reports/query-engine.ts";
import {
  localDateStart,
  type TemporalRange,
} from "#src/reports/temporal-range.ts";
import { visualizationBucketLabels } from "#src/reports/visualization-buckets.ts";

/**
 * Point construction for visualization snapshots: what a row contributes to a
 * series, where it sits on the axis, and which buckets an empty period still
 * has to show.
 */

export type SnapshotAxes = { seriesDim: number; pointDim: number } | undefined;

export type SnapshotContext = {
  plan: ScoutQlPlan;
  bucket: ResolvedTemporalBucket | null;
  /** Index of the temporal grouping in `plan.groupings`, when there is one. */
  temporalIndex: number | null;
  /** The zone the temporal buckets were computed in. */
  timezone: string;
  range: TemporalRange;
  /** Whether the window is bounded, so empty buckets can be enumerated. */
  fillBuckets: boolean;
  hasComparison: boolean;
  /** Width of the numeric bucket a histogram grouping produces. */
  histogram: HistogramBuckets | null;
  generatedAt: Date;
};

export type HistogramBuckets = {
  width: number;
  /** True when the grouping keeps the FLOOR index rather than scaling it. */
  indexed: boolean;
};

/**
 * The bucket geometry behind `GROUP BY FLOOR(x / w) * w` (or the bare
 * `FLOOR(x / w)`), so the histogram's bars can be labelled with the range they
 * actually cover instead of with the raw key.
 */
export function histogramBuckets(
  grouping: ScoutQlGrouping | undefined,
): HistogramBuckets | null {
  if (grouping?.kind !== "expression") return null;
  const expr = grouping.expr;
  const scaled =
    expr.kind === "arithmetic" && expr.op === "*"
      ? (floorWidth(expr.left) ?? floorWidth(expr.right))
      : null;
  if (scaled !== null) {
    return { width: scaled, indexed: false };
  }
  const width = floorWidth(expr);
  return width === null ? null : { width, indexed: true };
}

function floorWidth(expr: ScoutQlScalarExpr): number | null {
  if (expr.kind !== "scalar-call" || expr.func !== "floor") return null;
  const [arg] = expr.args;
  if (arg?.kind !== "arithmetic" || arg.op !== "/") return null;
  return arg.right.kind === "literal" && typeof arg.right.value === "number"
    ? arg.right.value
    : null;
}

/**
 * A human bucket range: "300–599" for a 300-wide bucket starting at 300, or
 * the bare value when the bucket is a single unit. Fractional widths are
 * continuous, so their upper edge is the next bucket's start.
 */
export function histogramBucketLabel(
  key: number,
  buckets: HistogramBuckets,
): string {
  const start = buckets.indexed ? key * buckets.width : key;
  if (buckets.width === 1) return String(start);
  const end =
    Number.isInteger(buckets.width) && buckets.width >= 2
      ? start + buckets.width - 1
      : start + buckets.width;
  return `${String(start)}–${String(end)}`;
}

function histogramKey(row: ReportResultRow): number {
  const [key] = row.keys;
  if (typeof key !== "number") {
    throw new TypeError("A histogram bucket key must be numeric.");
  }
  return key;
}

/** Ascending bucket order, which a histogram's bars must be drawn in. */
export function compareHistogramRows(
  left: ReportResultRow,
  right: ReportResultRow,
): number {
  return histogramKey(left) - histogramKey(right);
}

export function pointLabel(
  context: SnapshotContext,
  row: ReportResultRow,
  axes: SnapshotAxes,
): string {
  if (context.histogram !== null) {
    return histogramBucketLabel(histogramKey(row), context.histogram);
  }
  if (context.temporalIndex !== null) {
    return row.dimensions[context.temporalIndex] ?? row.label;
  }
  if (axes !== undefined) {
    return row.dimensions[axes.pointDim] ?? row.label;
  }
  return row.label;
}

export function seriesLabel(
  context: SnapshotContext,
  row: ReportResultRow,
  axes: SnapshotAxes,
): string {
  if (context.temporalIndex !== null) {
    const rest = row.dimensions.filter(
      (_, index) => index !== context.temporalIndex,
    );
    return rest.length === 0 ? "All" : rest.join(" • ");
  }
  if (context.plan.groupings.length <= 1) return "All";
  return row.dimensions[axes?.seriesDim ?? 0] ?? "All";
}

export type PointInput = {
  context: SnapshotContext;
  row: ReportResultRow;
  column: string;
  label: string;
  index: number;
  evidence: NonNullable<ReportQueryResult["evidence"]>[number] | undefined;
};

export function pointFromRow(input: PointInput): TemporalSeriesPoint {
  const { context, row, column, label, index } = input;
  const value = requireValue(row, column);
  const bounds = pointBounds(context, label, index);
  const columnEvidence = input.evidence?.values.find(
    (candidate) => candidate.column === column,
  );
  return {
    key: label,
    label,
    start: bounds.start.toISOString(),
    end: bounds.end.toISOString(),
    value: typeof value.value === "number" ? value.value : null,
    ...numericChannelValue(context, row, "x", "xValue"),
    ...numericChannelValue(context, row, "size", "sizeValue"),
    comparisonValue:
      typeof value.comparisonValue === "number" ? value.comparisonValue : null,
    absoluteDelta: value.absoluteDelta ?? null,
    percentageDelta: value.percentageDelta ?? null,
    evidence: pointEvidence(value, columnEvidence),
    ...(context.hasComparison
      ? { comparisonEvidence: pointComparisonEvidence(value) }
      : {}),
  };
}

type ColumnEvidence = NonNullable<
  ReportQueryResult["evidence"]
>[number]["values"][number];

/**
 * The row's own evidence wins over the value's copy of it: both are computed
 * from the same companions, and the row-level list is the one the temporal
 * merge rewrites.
 */
function pointEvidence(
  value: ReportResultValue,
  columnEvidence: ColumnEvidence | undefined,
): TemporalSeriesPoint["evidence"] {
  return {
    sampleSize: columnEvidence?.sampleSize ?? value.sampleSize ?? 0,
    successes: columnEvidence?.successes ?? value.successes,
    numerator: columnEvidence?.numerator ?? value.numerator,
    denominator: columnEvidence?.denominator ?? value.denominator,
    confidenceInterval:
      columnEvidence?.confidenceInterval ?? value.confidenceInterval ?? null,
  };
}

function pointComparisonEvidence(
  value: ReportResultValue,
): TemporalSeriesPoint["evidence"] {
  return {
    sampleSize: value.comparisonSampleSize ?? 0,
    successes: value.comparisonSuccesses,
    numerator: value.comparisonNumerator,
    denominator: value.comparisonDenominator,
    confidenceInterval: value.comparisonConfidenceInterval ?? null,
  };
}

function numericChannelValue(
  context: SnapshotContext,
  row: ReportResultRow,
  channel: "x" | "size",
  property: "xValue" | "sizeValue",
): Partial<Pick<TemporalSeriesPoint, "xValue" | "sizeValue">> {
  const render = context.plan.render;
  if (!("encoding" in render)) return {};
  const column = render.encoding[channel];
  if (column === undefined) return {};
  const value = row.values.find((candidate) => candidate.column === column);
  return typeof value?.value === "number" ? { [property]: value.value } : {};
}

function requireValue(row: ReportResultRow, column: string): ReportResultValue {
  const value = row.values.find((candidate) => candidate.column === column);
  if (value === undefined) {
    throw new Error(
      `Visualization column ${column} is missing from ${row.label}.`,
    );
  }
  return value;
}

export function pointBounds(
  context: SnapshotContext,
  label: string,
  index: number,
): { start: Date; end: Date } {
  const { bucket } = context;
  if (bucket === null) {
    const start = new Date(context.generatedAt.getTime() + index * 1000);
    return { start, end: start };
  }
  if (bucket === "patch") {
    const start = new Date(context.range.startDate.getTime() + index * 1000);
    return { start, end: start };
  }
  const date = bucket === "month" ? `${label}-01` : label;
  const start = localDateStart(date, context.timezone);
  const nextDate =
    bucket === "day"
      ? addDays(parseISO(date), 1)
      : bucket === "week"
        ? addWeeks(parseISO(date), 1)
        : addMonths(parseISO(date), 1);
  const next = localDateStart(
    formatISO(nextDate, { representation: "date" }),
    context.timezone,
  );
  return { start, end: new Date(next.getTime() - 1) };
}

/**
 * Every bucket the window covers, so a quiet week is a zero rather than a gap.
 * Only done when the window is bounded: over all ingested history there is no
 * enumerable set of buckets to fill, and inventing one back to the epoch would
 * plot decades of emptiness.
 */
export function fillMissingBuckets(input: {
  context: SnapshotContext;
  points: TemporalSeriesPoint[];
  additive: boolean;
}): TemporalSeriesPoint[] {
  const { context, points, additive } = input;
  const { bucket } = context;
  if (bucket === null || bucket === "patch" || !context.fillBuckets) {
    return points;
  }
  const byLabel = new Map(points.map((point) => [point.label, point]));
  const filled: TemporalSeriesPoint[] = [];
  for (const label of visualizationBucketLabels(
    { range: context.range, timezone: context.timezone },
    bucket,
  )) {
    const existing = byLabel.get(label);
    if (existing !== undefined) {
      filled.push(existing);
      continue;
    }
    const bounds = pointBounds(context, label, filled.length);
    filled.push({
      key: label,
      label,
      start: bounds.start.toISOString(),
      end: bounds.end.toISOString(),
      value: additive ? 0 : null,
      comparisonValue: additive && context.hasComparison ? 0 : null,
      absoluteDelta: additive && context.hasComparison ? 0 : null,
      percentageDelta: null,
      evidence: { sampleSize: 0, confidenceInterval: null },
      ...(context.hasComparison
        ? { comparisonEvidence: { sampleSize: 0, confidenceInterval: null } }
        : {}),
    });
  }
  return filled;
}
