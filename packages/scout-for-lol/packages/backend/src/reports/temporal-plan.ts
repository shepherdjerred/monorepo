import { match } from "ts-pattern";
import type {
  ResolvedTemporalBucket,
  TemporalAnalysisSpec,
} from "@scout-for-lol/data";
import type {
  ScoutQlPlan,
  ScoutQlTimeWindow,
} from "@scout-for-lol/data/model/scoutql/plan.ts";
import { subDays, subMonths, subWeeks, subYears } from "date-fns";
import {
  calendarRange,
  type TemporalRange,
} from "#src/reports/temporal-range.ts";
import { localCalendarDate } from "#src/reports/temporal-labels.ts";

/**
 * What a v2 plan says about time.
 *
 * `DURING` and `ANALYZE` are gone: a query states its window as ordinary WHERE
 * conjuncts, which the compiler recognizes structurally and hoists into
 * `plan.timeWindow`, and it buckets by writing `GROUP BY DATE_TRUNC('week', …)`
 * or `GROUP BY patch`. So the engine reads a window and a grouping rather than
 * an analysis object, and period-over-period comparison is a RENDER option.
 */

export type PlanTemporalGrouping = {
  /** Index into `plan.groupings`. */
  index: number;
  bucket: ResolvedTemporalBucket;
  /** The zone the bucket boundaries were computed in ("UTC" for patch). */
  timezone: string;
};

/**
 * The plan's temporal grouping, if it has one. A DATE_TRUNC grouping buckets
 * by day/week/month; grouping by the `patch` dimension buckets by patch, which
 * is a time axis with no calendar arithmetic behind it.
 */
export function planTemporalGrouping(
  plan: ScoutQlPlan,
): PlanTemporalGrouping | null {
  for (const [index, grouping] of plan.groupings.entries()) {
    if (grouping.kind === "date-trunc") {
      return { index, bucket: grouping.part, timezone: grouping.timezone };
    }
    if (grouping.kind === "column" && grouping.column === "patch") {
      return { index, bucket: "patch", timezone: "UTC" };
    }
  }
  return null;
}

/**
 * The execution range a structural window resolves to.
 *
 * An unbounded window starts at the epoch rather than at the lake's own
 * minimum timestamp: the predicate compiles to a bound BETWEEN either way, no
 * League match predates 2009, and asking the lake for its floor would add a
 * round trip to every all-history query to move a boundary that excludes
 * nothing. `bounded` means a time predicate exists that the compiler did not
 * recognize — it stays in `where` and is applied there, so the engine range
 * must not narrow it further.
 */
export function windowRange(
  window: ScoutQlTimeWindow,
  now: Date,
): TemporalRange {
  return match(window)
    .with({ kind: "relative" }, (relative) => ({
      // Clamped at the epoch: a large enough amount would otherwise run past
      // the representable Date range and turn every bound timestamp into NaN.
      // A window reaching the epoch already selects every row.
      startDate: new Date(
        Math.max(
          relativeStart(relative.amount, relative.unit, now).getTime(),
          0,
        ),
      ),
      endDate: now,
    }))
    .with({ kind: "calendar" }, (calendar) =>
      calendarRange(calendar.startDate, calendar.endDate, calendar.timezone),
    )
    .with(
      { kind: "bounded" },
      { kind: "unbounded" },
      { kind: "snapshot" },
      () => ({
        startDate: new Date(0),
        endDate: now,
      }),
    )
    .exhaustive();
}

function relativeStart(
  amount: number,
  unit: "day" | "week" | "month" | "year",
  now: Date,
): Date {
  return match(unit)
    .with("day", () => subDays(now, amount))
    .with("week", () => subWeeks(now, amount))
    .with("month", () => subMonths(now, amount))
    .with("year", () => subYears(now, amount))
    .exhaustive();
}

/** Whether the window names a real period rather than all ingested history. */
export function windowIsBounded(window: ScoutQlTimeWindow): boolean {
  return window.kind === "relative" || window.kind === "calendar";
}

/** The `compare` render option, or undefined when the query asks for none. */
export function planComparison(
  plan: ScoutQlPlan,
): "previous_period" | undefined {
  const render = plan.render;
  // Only chart kinds carry chart options; a table's options are a different
  // shape entirely, and neither carries `compare`.
  return "encoding" in render ? render.options.compare : undefined;
}

export type TemporalContext = {
  bucket: ResolvedTemporalBucket;
  /** Index of the temporal grouping in `plan.groupings`. */
  groupingIndex: number;
  timezone: string;
  ranges: { current: TemporalRange; comparison: TemporalRange };
  comparison: "previous_period";
};

/**
 * The immediately preceding window of equal length. Inclusive on both ends, so
 * the two ranges tile rather than overlap by a millisecond.
 */
export function previousPeriodRange(current: TemporalRange): TemporalRange {
  const inclusiveSpan =
    current.endDate.getTime() - current.startDate.getTime() + 1;
  return {
    startDate: new Date(current.startDate.getTime() - inclusiveSpan),
    endDate: new Date(current.startDate.getTime() - 1),
  };
}

/**
 * Build the comparison context for `RENDER … WITH (compare = previous_period)`.
 *
 * The analyzer already refuses the two shapes that cannot mean anything — a
 * comparison with no time axis to align on, and one over an unbounded window
 * whose "preceding period" would be prehistory — but the engine asserts them
 * too: reaching here without them would silently produce a comparison against
 * an arbitrary range, which is worse than an error.
 */
export function resolveTemporalContext(
  plan: ScoutQlPlan,
  current: TemporalRange,
): TemporalContext | null {
  const comparison = planComparison(plan);
  if (comparison === undefined) return null;
  const grouping = planTemporalGrouping(plan);
  if (grouping === null) {
    throw new Error(
      "compare = previous_period needs a time axis to align the two periods on — add GROUP BY DATE_TRUNC('week', game_creation_at) or GROUP BY patch.",
    );
  }
  if (!windowIsBounded(plan.timeWindow)) {
    throw new Error(
      "compare = previous_period needs a bounded time window — the preceding period of all ingested history is not a period.",
    );
  }
  return {
    bucket: grouping.bucket,
    groupingIndex: grouping.index,
    timezone: grouping.timezone,
    ranges: { current, comparison: previousPeriodRange(current) },
    comparison,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The snapshot's `temporal` field: the same analysis spec stored snapshots
 * have always carried, rebuilt from the v2 plan so that Explore shares and run
 * history written before this change keep parsing and rendering unchanged.
 * Expressible only when the query has both a time axis and a real window;
 * otherwise the snapshot honestly carries no analysis (its `bucket` field
 * still states the axis).
 */
export function planTemporalSpec(
  plan: ScoutQlPlan,
  range: TemporalRange,
  comparison: "previous_period" | undefined,
): TemporalAnalysisSpec | null {
  const grouping = planTemporalGrouping(plan);
  if (grouping === null || !rangeIsBounded(range)) return null;
  return {
    window: specWindow(plan, range, grouping.timezone),
    bucket: grouping.bucket,
    timezone: grouping.timezone,
    ...(comparison === undefined ? {} : { comparison: { kind: comparison } }),
  };
}

/**
 * Whether the executed range names a period rather than all ingested history.
 * The plan's own window is not the whole answer: a competition report states
 * no window at all and is handed its range at execution.
 */
export function rangeIsBounded(range: TemporalRange): boolean {
  return range.startDate.getTime() > 0;
}

function specWindow(
  plan: ScoutQlPlan,
  range: TemporalRange,
  timezone: string,
): TemporalAnalysisSpec["window"] {
  // Keep the author's own words where they said them; otherwise describe the
  // range that actually executed, in the bucket's timezone.
  if (plan.timeWindow.kind === "calendar") {
    return {
      kind: "calendar",
      startDate: plan.timeWindow.startDate,
      endDate: plan.timeWindow.endDate,
    };
  }
  if (plan.timeWindow.kind === "relative") {
    return {
      kind: "relative",
      days: Math.max(
        1,
        Math.round(
          (range.endDate.getTime() - range.startDate.getTime()) / DAY_MS,
        ),
      ),
    };
  }
  return {
    kind: "calendar",
    startDate: localCalendarDate(range.startDate, timezone),
    endDate: localCalendarDate(range.endDate, timezone),
  };
}
