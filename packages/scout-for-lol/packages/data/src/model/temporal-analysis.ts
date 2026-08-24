import { differenceInCalendarDays, parseISO } from "date-fns";
import { z } from "zod";
import { ReportScheduleTimezoneSchema } from "#src/model/competition-cron.ts";
import {
  ReportChartOptionsSchema,
  ReportChartPaletteSchema,
  ReportChartThemeSchema,
  ReportDisplayKindSchema,
} from "#src/model/report.ts";

export const VISUALIZATION_MAX_SERIES = 8;
export const VISUALIZATION_MAX_POINTS = 2000;

export const TemporalBucketSchema = z.enum([
  "auto",
  "day",
  "week",
  "month",
  "patch",
]);
export type TemporalBucket = z.infer<typeof TemporalBucketSchema>;

export const ResolvedTemporalBucketSchema = z.enum([
  "day",
  "week",
  "month",
  "patch",
]);
export type ResolvedTemporalBucket = z.infer<
  typeof ResolvedTemporalBucketSchema
>;

/**
 * A rolling window of N whole days. Shared with `DURING LAST <n> DAYS`
 * (report-query-window.ts) because it is the same concept in both clauses —
 * the calendar variants differ, but this one must not drift.
 */
export const RelativeTemporalWindowSchema = z
  .object({
    kind: z.literal("relative"),
    days: z.number().int().positive(),
  })
  .strict();

export const TemporalWindowSchema = z.discriminatedUnion("kind", [
  RelativeTemporalWindowSchema,
  z
    .object({
      kind: z.literal("calendar"),
      startDate: z.iso.date(),
      endDate: z.iso.date(),
    })
    .strict(),
]);
export type TemporalWindow = z.infer<typeof TemporalWindowSchema>;

export const TemporalComparisonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("previous_period") }).strict(),
  z
    .object({
      kind: z.literal("calendar"),
      startDate: z.iso.date(),
      endDate: z.iso.date(),
    })
    .strict(),
]);
export type TemporalComparison = z.infer<typeof TemporalComparisonSchema>;

export const TemporalAnalysisSpecSchema = z
  .object({
    window: TemporalWindowSchema,
    bucket: TemporalBucketSchema.default("auto"),
    comparison: TemporalComparisonSchema.optional(),
    timezone: ReportScheduleTimezoneSchema,
  })
  .strict()
  .superRefine((spec, ctx) => {
    validateCalendarWindow(spec.window, ["window"], ctx);
    if (spec.comparison?.kind === "calendar") {
      validateCalendarWindow(spec.comparison, ["comparison"], ctx);
      const currentDays = temporalWindowDays(spec.window);
      const comparisonDays = temporalWindowDays(spec.comparison);
      if (currentDays !== comparisonDays) {
        ctx.addIssue({
          code: "custom",
          path: ["comparison"],
          message:
            "A custom comparison period must have the same length as the analysis period.",
        });
      }
    }
  });
export type TemporalAnalysisSpec = z.infer<typeof TemporalAnalysisSpecSchema>;

type CalendarDateRange = {
  startDate: string;
  endDate: string;
};

function validateCalendarWindow(
  window: TemporalWindow | TemporalComparison,
  path: string[],
  ctx: z.RefinementCtx,
): void {
  if (window.kind !== "calendar") return;
  if (temporalWindowDays(window) < 1) {
    ctx.addIssue({
      code: "custom",
      path,
      message: "The end date must be on or after the start date.",
    });
  }
}

export function temporalWindowDays(
  window: TemporalWindow | CalendarDateRange,
): number {
  if ("kind" in window && window.kind === "relative") return window.days;
  return (
    differenceInCalendarDays(
      parseISO(window.endDate),
      parseISO(window.startDate),
    ) + 1
  );
}

/**
 * No window length limit.
 *
 * The 365-day cap that used to live here was not a product decision — it was
 * the only thing standing between `BUCKET BY DAY` and a bucket walk that
 * allocates one entry per bucket. That is now bounded arithmetically by
 * `projectedBucketCount` against VISUALIZATION_MAX_POINTS, before any label is
 * built, so an over-large window is refused with a message about points rather
 * than by an arbitrary day count.
 */
export function validateReportTemporalAnalysis(
  spec: TemporalAnalysisSpec,
): TemporalAnalysisSpec {
  const parsed = TemporalAnalysisSpecSchema.parse(spec);
  return parsed;
}

export function resolveTemporalBucket(
  requested: TemporalBucket,
  windowDays: number,
): ResolvedTemporalBucket {
  if (requested !== "auto") return requested;
  if (windowDays <= 60) return "day";
  if (windowDays <= 365) return "week";
  return "month";
}

const ANALYZE_PATTERN =
  /^(?:last\s+(?<days>\d+)\s+days?|between\s+'(?<start>\d{4}-\d{2}-\d{2})'\s+and\s+'(?<end>\d{4}-\d{2}-\d{2})')(?:\s+bucket\s+by\s+(?<bucket>auto|day|week|month|patch))?(?:\s+compare\s+to\s+(?:previous\s+period|between\s+'(?<comparisonStart>\d{4}-\d{2}-\d{2})'\s+and\s+'(?<comparisonEnd>\d{4}-\d{2}-\d{2})'))?(?:\s+in\s+time\s+zone\s+'(?<timezone>[^']+)')?$/iu;

export function parseTemporalAnalysisClause(
  value: string,
): TemporalAnalysisSpec {
  const match = ANALYZE_PATTERN.exec(value.trim());
  const groups = match?.groups;
  if (groups === undefined) {
    throw new Error(
      "Invalid ANALYZE clause. Expected LAST <days> DAYS or BETWEEN '<date>' AND '<date>', followed by optional BUCKET, COMPARE, and IN TIME ZONE clauses.",
    );
  }
  const days = groups["days"];
  const startDate = groups["start"];
  const endDate = groups["end"];
  const comparisonStart = groups["comparisonStart"];
  const comparisonEnd = groups["comparisonEnd"];
  const comparesToPrevious = /\bcompare\s+to\s+previous\s+period\b/iu.test(
    value,
  );
  const window =
    days === undefined
      ? { kind: "calendar", startDate, endDate }
      : { kind: "relative", days: Number(days) };
  const comparison =
    comparisonStart !== undefined && comparisonEnd !== undefined
      ? {
          kind: "calendar",
          startDate: comparisonStart,
          endDate: comparisonEnd,
        }
      : comparesToPrevious
        ? { kind: "previous_period" }
        : undefined;
  return validateReportTemporalAnalysis(
    TemporalAnalysisSpecSchema.parse({
      window,
      bucket: groups["bucket"]?.toLowerCase() ?? "auto",
      comparison,
      timezone: groups["timezone"] ?? "UTC",
    }),
  );
}

export function formatTemporalAnalysis(spec: TemporalAnalysisSpec): string[] {
  const parsed = TemporalAnalysisSpecSchema.parse(spec);
  const analyze =
    parsed.window.kind === "relative"
      ? `ANALYZE LAST ${parsed.window.days.toString()} DAYS`
      : `ANALYZE BETWEEN '${parsed.window.startDate}' AND '${parsed.window.endDate}'`;
  const clauses = [analyze, `BUCKET BY ${parsed.bucket.toUpperCase()}`];
  if (parsed.comparison?.kind === "previous_period") {
    clauses.push("COMPARE TO PREVIOUS PERIOD");
  } else if (parsed.comparison?.kind === "calendar") {
    clauses.push(
      `COMPARE TO BETWEEN '${parsed.comparison.startDate}' AND '${parsed.comparison.endDate}'`,
    );
  }
  clauses.push(`IN TIME ZONE '${parsed.timezone}'`);
  return clauses;
}

export const ConfidenceIntervalSchema = z
  .object({
    level: z.literal(0.95),
    lower: z.number().min(0).max(1),
    upper: z.number().min(0).max(1),
  })
  .strict();
export type ConfidenceInterval = z.infer<typeof ConfidenceIntervalSchema>;

export const TemporalMetricEvidenceSchema = z
  .object({
    sampleSize: z.number().int().nonnegative(),
    successes: z.number().int().nonnegative().optional(),
    numerator: z.number().optional(),
    denominator: z.number().nonnegative().optional(),
    confidenceInterval: ConfidenceIntervalSchema.nullable().default(null),
  })
  .strict();
export type TemporalMetricEvidence = z.infer<
  typeof TemporalMetricEvidenceSchema
>;

export const TemporalSeriesPointSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    value: z.number().nullable(),
    xValue: z.number().nullable().optional(),
    sizeValue: z.number().nullable().optional(),
    comparisonValue: z.number().nullable().optional(),
    absoluteDelta: z.number().nullable().optional(),
    percentageDelta: z.number().nullable().optional(),
    evidence: TemporalMetricEvidenceSchema,
    comparisonEvidence: TemporalMetricEvidenceSchema.nullable().optional(),
  })
  .strict();
export type TemporalSeriesPoint = z.infer<typeof TemporalSeriesPointSchema>;

export const TemporalSeriesSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    metric: z.string().min(1),
    /**
     * How this series' values format — percent, duration, count, decimal.
     *
     * Optional because snapshots are persisted: one stored before ScoutQL v2
     * has no display kind, and the renderer falls back to the frozen legacy
     * metric table for those. New snapshots always carry it, which is what
     * makes formatting independent of what an author happened to name the
     * output. Under v1 `metric` was a member of a closed metric enum, so the
     * renderer could look its kind up; in v2 it is an arbitrary alias, and a
     * rate aliased anything other than a known metric name would have
     * rendered as a bare 0.6 rather than 60%.
     */
    displayKind: ReportDisplayKindSchema.optional(),
    additive: z.boolean(),
    points: z.array(TemporalSeriesPointSchema),
  })
  .strict();
export type TemporalSeries = z.infer<typeof TemporalSeriesSchema>;

export const VisualizationAnnotationSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      "patch_transition",
      "season_boundary",
      "competition_start",
      "competition_end",
    ]),
    timestamp: z.iso.datetime(),
    label: z.string().min(1),
  })
  .strict();
export type VisualizationAnnotation = z.infer<
  typeof VisualizationAnnotationSchema
>;

export const VisualizationTrendSchema = z
  .object({
    seriesId: z.string().min(1),
    slope: z.number(),
    rSquared: z.number().min(0).max(1),
    values: z.array(z.number().nullable()),
  })
  .strict();
export type VisualizationTrend = z.infer<typeof VisualizationTrendSchema>;

export const VisualizationSnapshotSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.iso.datetime(),
    kind: z.string().min(1),
    title: z.string().min(1).nullable(),
    temporal: TemporalAnalysisSpecSchema.nullable(),
    bucket: ResolvedTemporalBucketSchema.nullable(),
    display: z
      .object({
        theme: ReportChartThemeSchema.nullable(),
        palette: ReportChartPaletteSchema.nullable(),
        smooth: z.boolean(),
        stack: z.enum(["none", "normal", "percent"]),
        rollingWindow: z.number().int().min(2).max(52).nullable(),
        cumulative: z.boolean(),
        sparkline: z.boolean(),
        options: ReportChartOptionsSchema.nullable().optional(),
      })
      .strict(),
    series: z.array(TemporalSeriesSchema).max(VISUALIZATION_MAX_SERIES),
    annotations: z.array(VisualizationAnnotationSchema),
    trends: z.array(VisualizationTrendSchema),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const points = snapshot.series.reduce(
      (total, series) => total + series.points.length,
      0,
    );
    if (points > VISUALIZATION_MAX_POINTS) {
      ctx.addIssue({
        code: "custom",
        path: ["series"],
        message: `Visualizations may contain at most ${VISUALIZATION_MAX_POINTS.toString()} points.`,
      });
    }
  });
export type VisualizationSnapshot = z.infer<typeof VisualizationSnapshotSchema>;
