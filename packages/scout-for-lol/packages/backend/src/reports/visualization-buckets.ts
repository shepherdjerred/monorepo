import {
  VISUALIZATION_MAX_POINTS,
  type ResolvedTemporalBucket,
} from "@scout-for-lol/data";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  formatISO,
  parseISO,
} from "date-fns";
import { localCalendarDate } from "#src/reports/temporal-labels.ts";
import type { TemporalRange } from "#src/reports/temporal-range.ts";

export type BucketWindow = {
  range: TemporalRange;
  /** The zone the DATE_TRUNC grouping computed its boundaries in. */
  timezone: string;
};

/**
 * How many buckets a window covers, by arithmetic rather than by counting.
 *
 * This exists so the point budget can be checked BEFORE any labels are built.
 * `visualizationBucketLabels` walks a cursor and pushes one string per bucket,
 * so asking it for a length is only safe once the window is known to be small.
 * A `GROUP BY DATE_TRUNC('day', …)` over a large enough window would otherwise
 * allocate one string per day before anything compared it to the limit — a
 * validation error turned into an out-of-memory crash that any user with
 * report-edit rights could trigger.
 */
export function projectedBucketCount(
  window: BucketWindow,
  bucket: Exclude<ResolvedTemporalBucket, "patch">,
): number {
  // The same two cursors the walk starts and ends on, so the count is exact
  // rather than an estimate — only the allocation is skipped.
  const start = bucketCursor(
    localCalendarDate(window.range.startDate, window.timezone),
    bucket,
  );
  const end = bucketCursor(
    localCalendarDate(window.range.endDate, window.timezone),
    bucket,
  );
  const spans =
    bucket === "day"
      ? differenceInCalendarDays(end, start)
      : bucket === "week"
        ? differenceInCalendarWeeks(end, start)
        : differenceInCalendarMonths(end, start);
  return spans < 0 ? 0 : spans + 1;
}

export function assertProjectedPointCount(input: {
  rowCount: number;
  columnCount: number;
  seriesGroupCount: number;
  bucket: ResolvedTemporalBucket | null;
  /** Absent when the buckets cannot be enumerated (an unbounded window). */
  window: BucketWindow | null;
}): void {
  const pointsPerColumn =
    input.bucket === null || input.bucket === "patch" || input.window === null
      ? input.rowCount
      : input.seriesGroupCount *
        projectedBucketCount(input.window, input.bucket);
  const projectedPoints = pointsPerColumn * input.columnCount;
  if (projectedPoints > VISUALIZATION_MAX_POINTS) {
    throw new Error(
      `Visualizations may contain at most ${VISUALIZATION_MAX_POINTS.toString()} points; this query would plot ${projectedPoints.toString()}.`,
    );
  }
}

export function visualizationBucketLabels(
  window: BucketWindow,
  bucket: Exclude<ResolvedTemporalBucket, "patch">,
): string[] {
  const labels: string[] = [];
  let cursor = bucketCursor(
    localCalendarDate(window.range.startDate, window.timezone),
    bucket,
  );
  const end = bucketCursor(
    localCalendarDate(window.range.endDate, window.timezone),
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
