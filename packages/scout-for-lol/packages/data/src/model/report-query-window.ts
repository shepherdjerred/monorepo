import { differenceInCalendarDays, parseISO } from "date-fns";
import { z } from "zod";
import { ReportScheduleTimezoneSchema } from "#src/model/competition-cron.ts";
import {
  RelativeTemporalWindowSchema,
  type TemporalAnalysisSpec,
} from "#src/model/temporal-analysis.ts";

/**
 * The time period a report query covers — the `DURING` clause.
 *
 * Every query must state one. There is deliberately no default: a window that
 * can be omitted is a window nobody states, and an answer computed over a
 * narrower period than the reader assumes is indistinguishable from a correct
 * one. Explore shipped for months reporting a player's last 30 days as their
 * whole history because the window defaulted silently.
 *
 * This is the non-bucketed sibling of {@link TemporalAnalysisSpec}. `ANALYZE`
 * carries its own window *and* turns the query into a time series; `DURING`
 * only bounds it. A query may have one or the other, never both.
 */

export const ReportQueryWindowSchema = z.discriminatedUnion("kind", [
  RelativeTemporalWindowSchema,
  // A timezone only appears here. A relative window is a rolling subtraction of
  // milliseconds and an all-time window has no edges, so neither has a calendar
  // day whose boundary a timezone could move.
  z
    .object({
      kind: z.literal("calendar"),
      startDate: z.iso.date(),
      endDate: z.iso.date(),
      timezone: ReportScheduleTimezoneSchema,
    })
    .strict(),
  z.object({ kind: z.literal("all_time") }).strict(),
]);
export type ReportQueryWindow = z.infer<typeof ReportQueryWindowSchema>;

/**
 * How many days the window spans, or `null` for all time.
 *
 * `null` rather than a large number on purpose: callers that bound work by
 * window length (bucket counts, chart point budgets) must decide explicitly
 * what an unbounded window means to them rather than inheriting a sentinel
 * that silently passes their comparison.
 */
export function reportQueryWindowDays(
  window: ReportQueryWindow,
): number | null {
  if (window.kind === "relative") return window.days;
  if (window.kind === "all_time") return null;
  return (
    differenceInCalendarDays(
      parseISO(window.endDate),
      parseISO(window.startDate),
    ) + 1
  );
}

const DURING_PATTERN =
  /^(?:last\s+(?<days>\d+)\s+days?|between\s+'(?<start>\d{4}-\d{2}-\d{2})'\s+and\s+'(?<end>\d{4}-\d{2}-\d{2})'(?:\s+in\s+time\s+zone\s+'(?<timezone>[^']+)')?|(?<allTime>all\s+time))$/iu;

export const INVALID_DURING_MESSAGE =
  "Invalid DURING clause. Expected DURING LAST <n> DAYS, DURING BETWEEN '<date>' AND '<date>' [IN TIME ZONE '<zone>'], or DURING ALL TIME.";

/** Parses the raw text following the `DURING` keyword. */
export function parseReportQueryWindowClause(value: string): ReportQueryWindow {
  const groups = DURING_PATTERN.exec(value.trim())?.groups;
  if (groups === undefined) {
    throw new Error(INVALID_DURING_MESSAGE);
  }
  if (groups["allTime"] !== undefined) {
    return ReportQueryWindowSchema.parse({ kind: "all_time" });
  }
  const days = groups["days"];
  if (days !== undefined) {
    return ReportQueryWindowSchema.parse({
      kind: "relative",
      days: Number(days),
    });
  }
  const window = ReportQueryWindowSchema.parse({
    kind: "calendar",
    startDate: groups["start"],
    endDate: groups["end"],
    timezone: groups["timezone"] ?? "UTC",
  });
  const spanDays = reportQueryWindowDays(window);
  if (spanDays !== null && spanDays < 1) {
    throw new Error("The end date must be on or after the start date.");
  }
  return window;
}

/**
 * The one time period a query covers, from whichever clause stated it.
 *
 * Three clauses can state a window and they are mutually exclusive, so this
 * resolves rather than merges. `undefined` means none was stated.
 *
 * An ANALYZE window is projected onto the plan even though execution reads the
 * analysis spec instead: keeping `window` meaningful on every plan means a
 * caller that bounds work by window length has exactly one field to read,
 * rather than two with a precedence rule to remember.
 */
export function resolveReportQueryWindow(input: {
  duringClause: string | undefined;
  lookbackDays: number | undefined;
  analysis: TemporalAnalysisSpec | undefined;
}): ReportQueryWindow | undefined {
  const { duringClause, lookbackDays, analysis } = input;
  if (duringClause !== undefined) {
    if (lookbackDays !== undefined) {
      throw new Error(
        "State the time period once: use either DURING or a timestamp lookback predicate, not both.",
      );
    }
    return parseReportQueryWindowClause(duringClause);
  }
  if (lookbackDays !== undefined) {
    return { kind: "relative", days: lookbackDays };
  }
  if (analysis === undefined) {
    return undefined;
  }
  return analysis.window.kind === "relative"
    ? { kind: "relative", days: analysis.window.days }
    : {
        kind: "calendar",
        startDate: analysis.window.startDate,
        endDate: analysis.window.endDate,
        timezone: analysis.timezone,
      };
}

export function formatReportQueryWindow(window: ReportQueryWindow): string {
  const parsed = ReportQueryWindowSchema.parse(window);
  if (parsed.kind === "relative") {
    return `DURING LAST ${parsed.days.toString()} DAYS`;
  }
  if (parsed.kind === "all_time") {
    return "DURING ALL TIME";
  }
  const zone =
    parsed.timezone === "UTC" ? "" : ` IN TIME ZONE '${parsed.timezone}'`;
  return `DURING BETWEEN '${parsed.startDate}' AND '${parsed.endDate}'${zone}`;
}
