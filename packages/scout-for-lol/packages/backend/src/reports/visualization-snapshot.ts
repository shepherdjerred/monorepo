import {
  VisualizationSnapshotSchema,
  cumulativeSeries,
  linearTrend,
  rollingSeries,
  type ResolvedTemporalBucket,
  type TemporalSeries,
  type VisualizationAnnotation,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import type {
  ReportQueryResult,
  ReportResultRow,
} from "#src/reports/query-engine.ts";
import { planGroupingNames } from "#src/reports/plan-columns.ts";
import { comparePatchLabels } from "#src/reports/temporal-labels.ts";
import {
  planTemporalGrouping,
  planTemporalSpec,
  rangeIsBounded,
} from "#src/reports/temporal-plan.ts";
import { assertProjectedPointCount } from "#src/reports/visualization-buckets.ts";
import {
  compareHistogramRows,
  fillMissingBuckets,
  histogramBuckets,
  pointFromRow,
  pointLabel,
  seriesLabel,
  type SnapshotAxes,
  type SnapshotContext,
} from "#src/reports/visualization-points.ts";
import { normalizePercentStack } from "#src/reports/visualization-series-transforms.ts";
import { rankBumpSeries } from "#src/reports/visualization-bump-ranks.ts";
import { resolveVisualizationAxes } from "#src/reports/heatmap-axes.ts";

/**
 * Build the renderer-facing snapshot from an executed plan.
 *
 * The time axis is now the plan's own DATE_TRUNC (or `patch`) grouping and the
 * window it executed over, rather than a separate ANALYZE clause. Two kinds
 * have shapes the renderer enforces and this module must produce exactly:
 * HISTOGRAM is ONE series of ascending buckets, and BOX_PLOT is FIVE series in
 * the encoding's `min, q1, median, q3, max` order, zipped by point key.
 */

export function buildVisualizationSnapshot(
  result: ReportQueryResult,
  generatedAt: Date,
  annotations: VisualizationAnnotation[] = [],
): VisualizationSnapshot {
  const plan = result.plan;
  const context = snapshotContext(result, generatedAt);
  const columns = visualizationColumns(plan);
  const series = transformSeries(buildSeries(result, context, columns), plan);
  const chartOptions =
    "encoding" in plan.render ? plan.render.options : undefined;
  return VisualizationSnapshotSchema.parse({
    version: 1,
    generatedAt: generatedAt.toISOString(),
    kind: plan.render.kind,
    title: chartOptions?.title ?? null,
    // The same analysis spec stored snapshots have always carried, rebuilt
    // from the v2 plan — old Explore shares and run history keep parsing.
    temporal: planTemporalSpec(plan, result.range, result.temporal?.comparison),
    bucket: context.bucket,
    display: snapshotDisplay(plan),
    series,
    annotations: snapshotAnnotations(plan, series, context.bucket, annotations),
    trends: snapshotTrends(plan, series),
  });
}

function snapshotContext(
  result: ReportQueryResult,
  generatedAt: Date,
): SnapshotContext {
  const plan = result.plan;
  const temporal = planTemporalGrouping(plan);
  return {
    plan,
    bucket: temporal?.bucket ?? null,
    temporalIndex: temporal?.index ?? null,
    timezone: temporal?.timezone ?? "UTC",
    range: result.range,
    fillBuckets: temporal !== null && rangeIsBounded(result.range),
    hasComparison: result.temporal !== undefined,
    histogram:
      plan.render.kind === "HISTOGRAM"
        ? histogramBuckets(plan.groupings[0])
        : null,
    generatedAt,
  };
}

function transformSeries(
  initialSeries: TemporalSeries[],
  plan: ScoutQlPlan,
): TemporalSeries[] {
  if (!("encoding" in plan.render)) return initialSeries;
  const chartOptions = plan.render.options;
  const hasComparison = chartOptions.compare !== undefined;
  let series = initialSeries;
  const rolling = chartOptions.rolling;
  if (rolling !== undefined) {
    series = series.map((item) => ({
      ...item,
      points: rollingSeries(
        item.points,
        rolling.window,
        item.additive ? "additive" : transformKind(plan, item.metric),
        hasComparison,
      ),
    }));
  }
  if (chartOptions.cumulative === true) {
    series = series.map((item) => ({
      ...item,
      points: cumulativeSeries(item.points, item.additive, hasComparison),
    }));
  }
  if (chartOptions.stack === "percent") {
    series = normalizePercentStack(series);
  }
  if (plan.render.kind === "BUMP_CHART") {
    series = rankBumpSeries(series);
  }
  return series;
}

/** A rolling window averages rates differently from other measures. */
function transformKind(plan: ScoutQlPlan, column: string): "rate" | "average" {
  const output = plan.outputs.find((candidate) => candidate.name === column);
  return output?.displayKind === "percent" ? "rate" : "average";
}

function snapshotTrends(plan: ScoutQlPlan, series: TemporalSeries[]) {
  return "encoding" in plan.render && plan.render.options.trend === true
    ? series.flatMap((item) => {
        const trend = linearTrend(item.id, item.points);
        return trend === null ? [] : [trend];
      })
    : [];
}

function snapshotAnnotations(
  plan: ScoutQlPlan,
  series: TemporalSeries[],
  bucket: ResolvedTemporalBucket | null,
  annotations: VisualizationAnnotation[],
): VisualizationAnnotation[] {
  if ("encoding" in plan.render && plan.render.options.annotations === false) {
    return [];
  }
  const derived =
    bucket === "patch"
      ? (series[0]?.points.slice(1).map((point) => ({
          id: `patch:${point.label}`,
          kind: "patch_transition" as const,
          timestamp: point.start,
          label: `Patch ${point.label}`,
        })) ?? [])
      : [];
  return [...annotations, ...derived];
}

function snapshotDisplay(plan: ScoutQlPlan) {
  const options = "encoding" in plan.render ? plan.render.options : undefined;
  return {
    theme: options?.theme ?? null,
    palette: options?.palette ?? null,
    smooth: options?.smooth ?? false,
    stack:
      options?.stack ??
      (plan.render.kind === "STACKED_BAR" ? "normal" : "none"),
    rollingWindow: options?.rolling?.window ?? null,
    cumulative: options?.cumulative ?? false,
    sparkline: resolveSparkline(plan),
    options: options ?? null,
  };
}

function resolveSparkline(plan: ScoutQlPlan): boolean {
  if (plan.render.kind === "TABLE") {
    return plan.render.options?.sparkline ?? false;
  }
  return "encoding" in plan.render
    ? (plan.render.options.sparkline ?? false)
    : false;
}

/**
 * Which output columns become series. A BOX_PLOT's five `y` outputs are
 * exactly this list, in the order the author wrote them — that order IS the
 * min/q1/median/q3/max encoding the renderer zips.
 */
function visualizationColumns(plan: ScoutQlPlan): string[] {
  // Grouping echoes are the axis, not a measure: `SELECT week, COUNT(*)`
  // plots the count against the week, never the week against itself. This is
  // the same default the analyzer's render-shape rules apply.
  const measures = plan.outputs
    .filter((output) => output.expr.kind !== "grouping-ref")
    .map((output) => output.name);
  if (!("encoding" in plan.render)) {
    return measures.slice(0, 8);
  }
  const y = plan.render.encoding.y;
  if (typeof y === "string") return [y];
  if (Array.isArray(y)) return y;
  const value = plan.render.encoding.value;
  if (value !== undefined) return [value];
  if (plan.render.kind === "BOX_PLOT") {
    // Five outputs, no explicit encoding: the SELECT order is the encoding.
    return measures.slice(0, 5);
  }
  return measures.slice(0, 1);
}

function buildSeries(
  result: ReportQueryResult,
  context: SnapshotContext,
  columns: string[],
): TemporalSeries[] {
  const { plan } = context;
  const axes = resolveVisualizationAxes(
    planGroupingNames(plan),
    plan.render.kind,
    "encoding" in plan.render ? plan.render.encoding : undefined,
    context.temporalIndex !== null,
  );
  const grouped = new Map<string, ReportResultRow[]>();
  for (const row of result.rows) {
    const key = seriesLabel(context, row, axes);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  if (
    context.temporalIndex !== null &&
    grouped.size === 0 &&
    plan.groupings.length === 1
  ) {
    grouped.set("All", []);
  }
  assertProjectedPointCount({
    rowCount: result.rows.length,
    columnCount: columns.length,
    seriesGroupCount: grouped.size,
    bucket: context.bucket,
    window: context.fillBuckets
      ? { range: context.range, timezone: context.timezone }
      : null,
  });
  const evidenceByRow = new Map(
    result.rows.map((row, index) => [row, result.evidence?.[index]]),
  );
  const series = [...grouped].flatMap(([label, rows]) =>
    columns.map((column) =>
      buildOneSeries({ context, axes, label, rows, column, evidenceByRow }),
    ),
  );
  if (series.length > 8) {
    if ("encoding" in plan.render) {
      throw new Error("A visualization may plot at most eight series.");
    }
    return series.slice(0, 8);
  }
  return series;
}

type OneSeriesInput = {
  context: SnapshotContext;
  axes: SnapshotAxes;
  label: string;
  rows: ReportResultRow[];
  column: string;
  evidenceByRow: Map<
    ReportResultRow,
    NonNullable<ReportQueryResult["evidence"]>[number] | undefined
  >;
};

function buildOneSeries(input: OneSeriesInput): TemporalSeries {
  const { context, axes, label, rows, column } = input;
  const plan = context.plan;
  const output = plan.outputs.find((candidate) => candidate.name === column);
  const additive = output?.additive ?? false;
  const points = orderedRows(context, axes, rows).map((row, index) =>
    pointFromRow({
      context,
      row,
      column,
      label: pointLabel(context, row, axes),
      index,
      evidence: input.evidenceByRow.get(row),
    }),
  );
  return {
    id: `${label}:${column}`,
    label:
      plan.render.kind === "HEATMAP"
        ? label
        : label === "All"
          ? column
          : `${label} — ${column}`,
    metric: column,
    // Carried so the renderer formats by what the value IS, not by what the
    // author happened to call it.
    ...(output === undefined ? {} : { displayKind: output.displayKind }),
    additive,
    points: fillMissingBuckets({ context, points, additive }),
  };
}

/**
 * Row order within a series. Histogram bars ascend by bucket, patch buckets
 * follow patch order, and calendar buckets sort by their ISO label — which is
 * chronological because the SQL label format is ISO.
 */
function orderedRows(
  context: SnapshotContext,
  axes: SnapshotAxes,
  rows: ReportResultRow[],
): ReportResultRow[] {
  if (context.histogram !== null) {
    return rows.toSorted(compareHistogramRows);
  }
  if (context.bucket === "patch") {
    return rows.toSorted((left, right) =>
      comparePatchLabels(
        pointLabel(context, left, axes),
        pointLabel(context, right, axes),
      ),
    );
  }
  if (context.bucket === null) return rows;
  return rows.toSorted((left, right) =>
    pointLabel(context, left, axes).localeCompare(
      pointLabel(context, right, axes),
    ),
  );
}
