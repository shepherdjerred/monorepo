import {
  VISUALIZATION_MAX_POINTS,
  type ReportQueryPlan,
  type ResolvedTemporalBucket,
} from "@scout-for-lol/data";
import { addDays, addMonths, addWeeks, formatISO, parseISO } from "date-fns";
import { resolveTemporalRanges } from "#src/reports/temporal-range.ts";
import { localCalendarDate } from "#src/reports/temporal-labels.ts";

export function assertProjectedPointCount(input: {
  rowCount: number;
  columnCount: number;
  seriesGroupCount: number;
  bucket: ResolvedTemporalBucket | null;
  plan: ReportQueryPlan;
  generatedAt: Date;
}): void {
  const pointsPerColumn =
    input.bucket === null || input.bucket === "patch"
      ? input.rowCount
      : input.seriesGroupCount *
        visualizationBucketLabels(input.plan, input.generatedAt, input.bucket)
          .length;
  const projectedPoints = pointsPerColumn * input.columnCount;
  if (projectedPoints > VISUALIZATION_MAX_POINTS) {
    throw new Error(
      `Visualizations may contain at most ${VISUALIZATION_MAX_POINTS.toString()} points; this query would plot ${projectedPoints.toString()}.`,
    );
  }
}

export function visualizationBucketLabels(
  plan: ReportQueryPlan,
  generatedAt: Date,
  bucket: Exclude<ResolvedTemporalBucket, "patch">,
): string[] {
  if (plan.analysis === undefined) return [];
  const range = resolveTemporalRanges(plan.analysis, generatedAt).current;
  const labels: string[] = [];
  let cursor = bucketCursor(
    localCalendarDate(range.startDate, plan.analysis.timezone),
    bucket,
  );
  const end = bucketCursor(
    localCalendarDate(range.endDate, plan.analysis.timezone),
    bucket,
  );
  while (cursor <= end) {
    labels.push(
      bucket === "month"
        ? formatISO(cursor, { representation: "date" }).slice(0, 7)
        : formatISO(cursor, { representation: "date" }),
    );
    cursor =
      bucket === "day"
        ? addDays(cursor, 1)
        : bucket === "week"
          ? addWeeks(cursor, 1)
          : addMonths(cursor, 1);
  }
  return labels;
}

function bucketCursor(
  date: string,
  bucket: Exclude<ResolvedTemporalBucket, "patch">,
): Date {
  const monthDate = bucket === "month" ? `${date.slice(0, 7)}-01` : date;
  const parsed = parseISO(monthDate);
  if (bucket !== "week") return parsed;
  return addDays(parsed, -((parsed.getDay() + 6) % 7));
}
