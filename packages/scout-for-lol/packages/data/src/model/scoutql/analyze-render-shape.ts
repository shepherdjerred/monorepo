import type {
  ScoutQlDiagnostic,
  ScoutQlSpan,
} from "#src/model/scoutql/diagnostics.ts";
import type {
  ReportChartOptions,
  ReportOutputFormat,
  ReportRenderChannel,
} from "#src/model/report.ts";
import type { ScoutQlTimeWindow } from "#src/model/scoutql/plan.ts";
import { emitDiagnostic } from "#src/model/scoutql/analyze-expr-shared.ts";
import type { AnalyzedGrouping } from "#src/model/scoutql/analyze-group.ts";
import type { AnalyzedOutput } from "#src/model/scoutql/analyze-select.ts";

// ── RENDER shape rules ───────────────────────────────────────────────────────
// Each chart kind needs a particular result shape to mean anything: a heatmap
// needs two dimensions, a radar needs several comparable metrics on one
// dimension, a KPI card needs a single row. Carried over from the legacy
// render validation, plus the two new kinds:
//
//   HISTOGRAM  one bucket (expression) grouping + a count-like y
//   BOX_PLOT   exactly five y outputs, in the order min, q1, median, q3, max
//
// The BOX_PLOT ordering is positional and documented rather than inferred: the
// author writes the five aggregates explicitly, which is the same
// explicit-SQL ethos as the rest of the language.

export type ShapeContext = {
  kind: ReportOutputFormat;
  encoding: ReportRenderChannel;
  options: ReportChartOptions;
  outputs: AnalyzedOutput[];
  groupings: AnalyzedGrouping[];
  timeWindow: ScoutQlTimeWindow;
  /** See `WhereAnalysis.residualTouchesTime`. */
  residualTouchesTime: boolean;
  span: ScoutQlSpan;
  diagnostics: ScoutQlDiagnostic[];
};

export const BOX_PLOT_CHANNEL_ORDER = [
  "min",
  "q1",
  "median",
  "q3",
  "max",
] as const;

function shapeError(ctx: ShapeContext, message: string): void {
  emitDiagnostic(ctx.diagnostics, {
    code: "render-shape-invalid",
    message,
    span: ctx.span,
  });
}

/** The y outputs, defaulting to every aggregate output when unstated. */
export function resolvedYOutputs(ctx: ShapeContext): AnalyzedOutput[] {
  const { y } = ctx.encoding;
  const names = y === undefined ? [] : Array.isArray(y) ? y : [y];
  if (names.length === 0) {
    return ctx.outputs.filter((output) => output.aggregate);
  }
  return names.flatMap((name) => {
    const output = ctx.outputs.find((candidate) => candidate.name === name);
    return output === undefined ? [] : [output];
  });
}

function temporalGrouping(ctx: ShapeContext): AnalyzedGrouping | undefined {
  return ctx.groupings.find(
    (grouping) =>
      grouping.grouping.kind === "date-trunc" ||
      (grouping.grouping.kind === "column" &&
        grouping.grouping.column === "patch"),
  );
}

function checkHeatmap(ctx: ShapeContext): void {
  if (ctx.groupings.length !== 2) {
    shapeError(
      ctx,
      "Heatmaps plot one metric across exactly two GROUP BY dimensions.",
    );
  }
}

function checkBumpChart(ctx: ShapeContext): void {
  if (ctx.groupings.length < 2) {
    shapeError(
      ctx,
      "Bump charts rank a dimension within each time bucket, so they need a DATE_TRUNC grouping plus one more.",
    );
  } else if (temporalGrouping(ctx) === undefined) {
    shapeError(
      ctx,
      "Bump charts need a DATE_TRUNC (or patch) grouping to rank within.",
    );
  }
  if (resolvedYOutputs(ctx).length !== 1) {
    shapeError(ctx, "Bump charts rank by exactly one y output.");
  }
}

function checkCalendarHeatmap(ctx: ShapeContext): void {
  const daily = ctx.groupings.find(
    (grouping) =>
      grouping.grouping.kind === "date-trunc" &&
      grouping.grouping.part === "day",
  );
  if (daily === undefined) {
    shapeError(
      ctx,
      "Calendar heatmaps need DATE_TRUNC('day', …) — one cell per calendar day.",
    );
  }
  if (ctx.groupings.length !== 1) {
    shapeError(
      ctx,
      "Calendar heatmaps take the daily bucket as their only grouping.",
    );
  }
  if (resolvedYOutputs(ctx).length !== 1) {
    shapeError(ctx, "Calendar heatmaps colour cells by exactly one y output.");
  }
}

function checkRadar(ctx: ShapeContext): void {
  const count = resolvedYOutputs(ctx).length;
  if (count < 3 || count > 8) {
    shapeError(ctx, "Radar charts compare between three and eight y outputs.");
  }
  if (ctx.groupings.length !== 1) {
    shapeError(ctx, "Radar charts overlay exactly one GROUP BY dimension.");
  }
}

function checkScatter(ctx: ShapeContext): void {
  const x = ctx.encoding.x;
  if (x === undefined || resolvedYOutputs(ctx).length !== 1) {
    shapeError(ctx, "Scatter charts need one x output and one y output.");
  } else if (!ctx.outputs.some((output) => output.name === x)) {
    shapeError(
      ctx,
      `Scatter chart x must be a SELECTed output; "${x}" is not.`,
    );
  }
}

function checkHistogram(ctx: ShapeContext): void {
  const [only] = ctx.groupings;
  if (only === undefined || ctx.groupings.length !== 1) {
    shapeError(
      ctx,
      "Histograms plot one distribution, so they take exactly one bucket grouping, e.g. GROUP BY FLOOR(game_duration_seconds / 300) * 300.",
    );
    return;
  }
  if (only.grouping.kind !== "expression") {
    shapeError(
      ctx,
      "Histogram buckets come from a numeric FLOOR grouping, e.g. GROUP BY FLOOR(game_duration_seconds / 300) * 300.",
    );
  }
  const y = resolvedYOutputs(ctx);
  const [first] = y;
  if (first === undefined || y.length !== 1) {
    shapeError(
      ctx,
      "Histograms show exactly one y output — the bucket's count.",
    );
    return;
  }
  if (first.displayKind !== "count") {
    shapeError(
      ctx,
      `Histogram bars count rows per bucket, so y must be a count; "${first.name}" is ${first.displayKind}.`,
    );
  }
}

function checkBoxPlot(ctx: ShapeContext): void {
  const y = resolvedYOutputs(ctx);
  if (y.length !== 5) {
    shapeError(
      ctx,
      `Box plots take exactly five y outputs in the order ${BOX_PLOT_CHANNEL_ORDER.join(", ")} — e.g. y = (low, q1, med, q3, high).`,
    );
    return;
  }
  const nonNumeric = y.find(
    (output) =>
      output.displayKind === "text" || output.displayKind === "timestamp",
  );
  if (nonNumeric !== undefined) {
    shapeError(
      ctx,
      `Box-plot outputs must be numeric; "${nonNumeric.name}" is ${nonNumeric.displayKind}.`,
    );
  }
}

function checkKpiCard(ctx: ShapeContext): void {
  if (ctx.groupings.length > 0) {
    shapeError(
      ctx,
      "KPI cards show one number, so the query must produce a single grand-total row (no GROUP BY).",
    );
  }
}

function checkDonut(ctx: ShapeContext): void {
  if (resolvedYOutputs(ctx).length !== 1) {
    shapeError(ctx, "Donut charts show the share of exactly one y output.");
  }
}

type ShapeCheck = (ctx: ShapeContext) => void;

const SHAPE_CHECKS: ReadonlyMap<ReportOutputFormat, ShapeCheck> = new Map<
  ReportOutputFormat,
  ShapeCheck
>([
  ["HEATMAP", checkHeatmap],
  ["BUMP_CHART", checkBumpChart],
  ["CALENDAR_HEATMAP", checkCalendarHeatmap],
  ["RADAR_CHART", checkRadar],
  ["SCATTER_CHART", checkScatter],
  ["HISTOGRAM", checkHistogram],
  ["BOX_PLOT", checkBoxPlot],
  ["KPI_CARD", checkKpiCard],
  ["DONUT_CHART", checkDonut],
]);

const PERCENT_STACK_KINDS: ReadonlySet<ReportOutputFormat> =
  new Set<ReportOutputFormat>(["STACKED_BAR", "AREA_CHART"]);

function checkTransforms(ctx: ShapeContext): void {
  if (ctx.options.stack === "percent" && !PERCENT_STACK_KINDS.has(ctx.kind)) {
    emitDiagnostic(ctx.diagnostics, {
      code: "render-option-invalid",
      message:
        "stack = percent applies to stacked_bar and area_chart, which are the kinds that stack.",
      span: ctx.span,
    });
  }
  if (ctx.options.cumulative === true) {
    const nonAdditive = resolvedYOutputs(ctx).find(
      (output) => !output.additive,
    );
    if (nonAdditive !== undefined) {
      emitDiagnostic(ctx.diagnostics, {
        code: "render-option-invalid",
        message: `cumulative accumulates a running total, which only means something for additive outputs (SUM/COUNT). "${nonAdditive.name}" is not additive.`,
        span: ctx.span,
      });
    }
  }
}

function checkCompare(ctx: ShapeContext): void {
  if (ctx.options.compare !== "previous_period") {
    return;
  }
  if (temporalGrouping(ctx) === undefined) {
    emitDiagnostic(ctx.diagnostics, {
      code: "render-compare-unavailable",
      message:
        "compare = previous_period overlays the preceding period per bucket, so it needs a DATE_TRUNC (or patch) grouping.",
      span: ctx.span,
    });
  }
  const window = ctx.timeWindow.kind;
  if (window !== "relative" && window !== "calendar") {
    emitDiagnostic(ctx.diagnostics, {
      code: "render-compare-unavailable",
      message:
        "compare = previous_period needs a stated time window to take the preceding period of — add e.g. game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY.",
      span: ctx.span,
    });
  }
  if (ctx.residualTouchesTime) {
    // Only the first recognized time conjunct is ever hoisted into
    // `timeWindow`; a second one (redundant lower bound, or a two-sided
    // range spelled as two comparisons instead of BETWEEN) stays in the
    // residual WHERE and is reused unchanged for the baseline's substituted,
    // chronologically earlier range — where it can silently make the
    // baseline empty rather than compare the periods it named.
    emitDiagnostic(ctx.diagnostics, {
      code: "render-compare-unavailable",
      message:
        "compare = previous_period needs the whole time window in ONE recognized bound — state it as a single relative bound (t >= CURRENT_TIMESTAMP - INTERVAL n DAY) or a single BETWEEN, not several ANDed time comparisons.",
      span: ctx.span,
    });
  }
}

export function checkRenderShape(ctx: ShapeContext): void {
  SHAPE_CHECKS.get(ctx.kind)?.(ctx);
  checkTransforms(ctx);
  checkCompare(ctx);
}
