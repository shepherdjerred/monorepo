import {
  REPORT_METRICS,
  VisualizationSnapshotSchema,
  collectExpressionMetrics,
  cumulativeSeries,
  linearTrend,
  resolveTemporalBucket,
  rollingSeries,
  temporalWindowDays,
  type ReportQueryPlan,
  type ResolvedTemporalBucket,
  type TemporalSeries,
  type TemporalSeriesPoint,
  type VisualizationAnnotation,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { addDays, addMonths, addWeeks, formatISO, parseISO } from "date-fns";
import type {
  ReportQueryResult,
  ReportResultRow,
  ReportResultValue,
} from "#src/reports/query-engine.ts";
import {
  localDateStart,
  resolveTemporalRanges,
} from "#src/reports/temporal-range.ts";

export function buildVisualizationSnapshot(
  result: ReportQueryResult,
  generatedAt: Date,
  annotations: VisualizationAnnotation[] = [],
): VisualizationSnapshot {
  const plan = result.plan;
  const bucket = resolvedBucket(plan);
  const columns = visualizationColumns(plan, result.columns);
  const series = transformSeries(
    buildSeries({ result, plan, columns, bucket, generatedAt }),
    plan,
  );
  const chartOptions =
    "encoding" in plan.render ? plan.render.options : undefined;
  const sparkline = resolveSparkline(plan);
  return VisualizationSnapshotSchema.parse({
    version: 1,
    generatedAt: generatedAt.toISOString(),
    kind: plan.render.kind,
    title: chartOptions?.title ?? null,
    temporal: plan.analysis ?? null,
    bucket,
    display: snapshotDisplay(plan, sparkline),
    series,
    annotations: snapshotAnnotations(plan, series, bucket, annotations),
    trends: snapshotTrends(plan, series),
  });
}

function transformSeries(
  initialSeries: TemporalSeries[],
  plan: ReportQueryPlan,
): TemporalSeries[] {
  if (!("encoding" in plan.render)) return initialSeries;
  const chartOptions = plan.render.options;
  let series = initialSeries;
  const rolling = chartOptions.rolling;
  if (rolling !== undefined) {
    series = series.map((item) => ({
      ...item,
      points: rollingSeries(
        item.points,
        rolling.window,
        item.additive ? "additive" : metricTransformKind(item.metric),
      ),
    }));
  }
  if (chartOptions.cumulative === true) {
    series = series.map((item) => ({
      ...item,
      points: cumulativeSeries(item.points, item.additive),
    }));
  }
  if (chartOptions.stack === "percent") {
    series = normalizePercentStack(series);
  }
  return series;
}

function snapshotTrends(plan: ReportQueryPlan, series: TemporalSeries[]) {
  return "encoding" in plan.render && plan.render.options.trend === true
    ? series.flatMap((item) => {
        const trend = linearTrend(item.id, item.points);
        return trend === null ? [] : [trend];
      })
    : [];
}

function snapshotAnnotations(
  plan: ReportQueryPlan,
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

function snapshotDisplay(plan: ReportQueryPlan, sparkline: boolean) {
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
    sparkline,
  };
}

function resolveSparkline(plan: ReportQueryPlan): boolean {
  if (plan.render.kind === "TABLE") {
    return plan.render.options?.sparkline ?? false;
  }
  return "encoding" in plan.render
    ? (plan.render.options.sparkline ?? false)
    : false;
}

function visualizationColumns(
  plan: ReportQueryPlan,
  resultColumns: string[],
): string[] {
  const numericColumns = resultColumns.filter((column) => column !== "label");
  if (!("encoding" in plan.render)) {
    return numericColumns.slice(0, 8);
  }
  const y = plan.render.encoding.y;
  if (typeof y === "string") return [y];
  if (Array.isArray(y)) return y;
  const value = plan.render.encoding.value;
  if (value !== undefined) return [value];
  return numericColumns.slice(0, 1);
}

function resolvedBucket(plan: ReportQueryPlan): ResolvedTemporalBucket | null {
  if (plan.analysis === undefined) return null;
  return resolveTemporalBucket(
    plan.analysis.bucket,
    temporalWindowDays(plan.analysis.window),
  );
}

type SeriesBuildContext = {
  result: ReportQueryResult;
  plan: ReportQueryPlan;
  columns: string[];
  bucket: ResolvedTemporalBucket | null;
  generatedAt: Date;
};

function buildSeries(context: SeriesBuildContext): TemporalSeries[] {
  const { result, plan, columns, bucket, generatedAt } = context;
  const rows = result.rows;
  const grouped = new Map<string, ReportResultRow[]>();
  for (const row of rows) {
    const seriesLabel =
      bucket === null
        ? plan.groupBys.length > 1
          ? (row.dimensions[0] ?? "All")
          : "All"
        : row.dimensions.slice(0, -1).join(" • ") || "All";
    const group = grouped.get(seriesLabel) ?? [];
    group.push(row);
    grouped.set(seriesLabel, group);
  }
  const series = [...grouped].flatMap(([seriesLabel, groupRows]) =>
    columns.map((column) => {
      const additive = isAdditiveColumn(plan, column);
      const points = groupRows
        .map((row, index) =>
          pointFromRow({
            row,
            column,
            bucket,
            plan,
            generatedAt,
            index,
            result,
          }),
        )
        .toSorted((left, right) => left.start.localeCompare(right.start));
      return {
        id: `${seriesLabel}:${column}`,
        label: seriesLabel === "All" ? column : `${seriesLabel} — ${column}`,
        metric: column,
        additive,
        points: fillMissingBuckets(points, bucket, additive, plan),
      };
    }),
  );
  if (series.length > 8) {
    throw new Error("A visualization may plot at most eight series.");
  }
  return series;
}

type PointBuildContext = Omit<SeriesBuildContext, "columns"> & {
  row: ReportResultRow;
  column: string;
  index: number;
};

function pointFromRow(context: PointBuildContext): TemporalSeriesPoint {
  const { row, column, bucket, plan, generatedAt, index, result } = context;
  const value = requireValue(row, column);
  const label =
    bucket === null && plan.groupBys.length <= 1
      ? row.label
      : (row.dimensions.at(-1) ?? row.label);
  const bounds = pointBounds({ label, bucket, plan, generatedAt, index });
  const evidence = result.evidence
    ?.find((rowEvidence) => rowEvidence.label === row.label)
    ?.values.find((candidate) => candidate.column === column);
  return {
    key: label,
    label,
    start: bounds.start.toISOString(),
    end: bounds.end.toISOString(),
    value: typeof value.value === "number" ? value.value : null,
    ...numericChannelValue(row, plan, "x", "xValue"),
    ...numericChannelValue(row, plan, "size", "sizeValue"),
    comparisonValue:
      typeof value.comparisonValue === "number" ? value.comparisonValue : null,
    absoluteDelta: value.absoluteDelta ?? null,
    percentageDelta: value.percentageDelta ?? null,
    evidence: {
      sampleSize: evidence?.sampleSize ?? value.sampleSize ?? 0,
      successes: evidence?.successes ?? value.successes,
      confidenceInterval:
        evidence?.confidenceInterval ?? value.confidenceInterval ?? null,
    },
  };
}

function numericChannelValue(
  row: ReportResultRow,
  plan: ReportQueryPlan,
  channel: "x" | "size",
  property: "xValue" | "sizeValue",
): Partial<Pick<TemporalSeriesPoint, "xValue" | "sizeValue">> {
  if (!("encoding" in plan.render)) return {};
  const column = plan.render.encoding[channel];
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

type PointBoundsContext = {
  label: string;
  bucket: ResolvedTemporalBucket | null;
  plan: ReportQueryPlan;
  generatedAt: Date;
  index: number;
};

function pointBounds(context: PointBoundsContext): { start: Date; end: Date } {
  const { label, bucket, plan, generatedAt, index } = context;
  if (bucket === null) {
    const start = new Date(generatedAt.getTime() + index * 1000);
    return { start, end: start };
  }
  if (bucket === "patch") {
    if (plan.analysis === undefined)
      throw new Error("Patch buckets require analysis.");
    const range = resolveTemporalRanges(plan.analysis, generatedAt).current;
    const start = new Date(range.startDate.getTime() + index * 1000);
    return { start, end: start };
  }
  if (plan.analysis === undefined)
    throw new Error("Temporal buckets require analysis.");
  const date = bucket === "month" ? `${label}-01` : label;
  const start = localDateStart(date, plan.analysis.timezone);
  const nextDate =
    bucket === "day"
      ? addDays(parseISO(date), 1)
      : bucket === "week"
        ? addWeeks(parseISO(date), 1)
        : addMonths(parseISO(date), 1);
  const next = localDateStart(
    formatISO(nextDate, { representation: "date" }),
    plan.analysis.timezone,
  );
  return { start, end: new Date(next.getTime() - 1) };
}

function fillMissingBuckets(
  points: TemporalSeriesPoint[],
  bucket: ResolvedTemporalBucket | null,
  additive: boolean,
  plan: ReportQueryPlan,
): TemporalSeriesPoint[] {
  if (bucket === null || bucket === "patch" || points.length < 2) return points;
  const byLabel = new Map(points.map((point) => [point.label, point]));
  const first = points[0];
  const last = points.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    plan.analysis === undefined
  ) {
    return points;
  }
  const result: TemporalSeriesPoint[] = [];
  let cursor = parseISO(bucket === "month" ? `${first.label}-01` : first.label);
  const end = parseISO(bucket === "month" ? `${last.label}-01` : last.label);
  while (cursor <= end) {
    const label =
      bucket === "month"
        ? formatISO(cursor, { representation: "date" }).slice(0, 7)
        : formatISO(cursor, { representation: "date" });
    const existing = byLabel.get(label);
    if (existing === undefined) {
      const bounds = pointBounds({
        label,
        bucket,
        plan,
        generatedAt: new Date(),
        index: result.length,
      });
      result.push({
        key: label,
        label,
        start: bounds.start.toISOString(),
        end: bounds.end.toISOString(),
        value: additive ? 0 : null,
        comparisonValue: null,
        absoluteDelta: null,
        percentageDelta: null,
        evidence: { sampleSize: 0, confidenceInterval: null },
      });
    } else {
      result.push(existing);
    }
    cursor =
      bucket === "day"
        ? addDays(cursor, 1)
        : bucket === "week"
          ? addWeeks(cursor, 1)
          : addMonths(cursor, 1);
  }
  return result;
}

function isAdditiveColumn(plan: ReportQueryPlan, column: string): boolean {
  const item = plan.selectItems.find((candidate) => candidate.key === column);
  if (item === undefined) return false;
  const metrics = collectExpressionMetrics(item.expression);
  return (
    metrics.length > 0 &&
    metrics.every((metric) =>
      REPORT_METRICS.some(
        (candidate) => candidate.id === metric && candidate.kind === "count",
      ),
    )
  );
}

function metricTransformKind(metric: string): "rate" | "average" {
  const info = REPORT_METRICS.find((candidate) => candidate.id === metric);
  return info?.kind === "rate" ? "rate" : "average";
}

function normalizePercentStack(series: TemporalSeries[]): TemporalSeries[] {
  const totals = new Map<string, number>();
  for (const item of series) {
    for (const point of item.points) {
      totals.set(point.key, (totals.get(point.key) ?? 0) + (point.value ?? 0));
    }
  }
  return series.map((item) => ({
    ...item,
    points: item.points.map((point) => {
      const total = totals.get(point.key) ?? 0;
      return {
        ...point,
        value: total === 0 ? null : (point.value ?? 0) / total,
      };
    }),
  }));
}
