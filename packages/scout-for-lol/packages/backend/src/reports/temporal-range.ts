import type {
  TemporalAnalysisSpec,
  TemporalComparison,
  TemporalWindow,
} from "@scout-for-lol/data";
import { temporalWindowDays } from "@scout-for-lol/data";
import { addDays, formatISO, parseISO } from "date-fns";

const DAY_MS = 24 * 60 * 60 * 1000;

export type TemporalRange = { startDate: Date; endDate: Date };
export type ResolvedTemporalRanges = {
  current: TemporalRange;
  comparison: TemporalRange | null;
};

export function resolveTemporalRanges(
  analysis: TemporalAnalysisSpec,
  now: Date,
): ResolvedTemporalRanges {
  const current = resolveWindow(analysis.window, analysis.timezone, now);
  const comparison = resolveComparison(
    analysis.comparison,
    analysis.window,
    analysis.timezone,
    current,
  );
  return { current, comparison };
}

export function clampTemporalRange(
  range: TemporalRange,
  boundary: { startDate: Date | null; endDate: Date | null },
  now: Date,
): TemporalRange {
  const configuredEnd = boundary.endDate ?? now;
  const startDate =
    boundary.startDate === null || range.startDate >= boundary.startDate
      ? range.startDate
      : boundary.startDate;
  const endBoundary = configuredEnd < now ? configuredEnd : now;
  const endDate = new Date(
    Math.min(range.endDate.getTime(), endBoundary.getTime()),
  );
  if (startDate > endDate) {
    throw new Error(
      "The selected period does not intersect the competition dates.",
    );
  }
  return { startDate, endDate };
}

function resolveWindow(
  window: TemporalWindow,
  timezone: string,
  now: Date,
): TemporalRange {
  if (window.kind === "relative") {
    return {
      startDate: new Date(now.getTime() - window.days * DAY_MS),
      endDate: now,
    };
  }
  return calendarRange(window.startDate, window.endDate, timezone);
}

function resolveComparison(
  comparison: TemporalComparison | undefined,
  window: TemporalWindow,
  timezone: string,
  current: TemporalRange,
): TemporalRange | null {
  if (comparison === undefined) return null;
  if (comparison.kind === "calendar") {
    return calendarRange(comparison.startDate, comparison.endDate, timezone);
  }
  if (window.kind === "calendar") {
    const previousEnd = formatISO(addDays(parseISO(window.startDate), -1), {
      representation: "date",
    });
    const previousStart = formatISO(
      addDays(parseISO(window.startDate), -temporalWindowDays(window)),
      { representation: "date" },
    );
    return calendarRange(previousStart, previousEnd, timezone);
  }
  const inclusiveSpan =
    current.endDate.getTime() - current.startDate.getTime() + 1;
  return {
    startDate: new Date(current.startDate.getTime() - inclusiveSpan),
    endDate: new Date(current.startDate.getTime() - 1),
  };
}

/**
 * A whole-day-inclusive range for two calendar dates in one timezone. Shared
 * with the plain `DURING BETWEEN` window so both temporal paths agree on where
 * a local day begins and ends.
 */
export function calendarRange(
  startDate: string,
  endDate: string,
  timezone: string,
): TemporalRange {
  const nextDate = formatISO(addDays(parseISO(endDate), 1), {
    representation: "date",
  });
  return {
    startDate: localDateStart(startDate, timezone),
    endDate: new Date(localDateStart(nextDate, timezone).getTime() - 1),
  };
}

export function localDateStart(date: string, timezone: string): Date {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(date);
  const groups = match?.groups;
  if (groups === undefined) throw new Error(`Invalid calendar date ${date}.`);
  const target = {
    year: Number(groups["year"]),
    month: Number(groups["month"]),
    day: Number(groups["day"]),
  };
  let timestamp = Date.UTC(target.year, target.month - 1, target.day);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (let iteration = 0; iteration < 3; iteration++) {
    const actual = dateParts(formatter, new Date(timestamp));
    const targetTimestamp = Date.UTC(target.year, target.month - 1, target.day);
    const actualTimestamp = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    timestamp += targetTimestamp - actualTimestamp;
  }
  return new Date(timestamp);
}

function dateParts(
  formatter: Intl.DateTimeFormat,
  date: Date,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const values = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const required = (
    key: "year" | "month" | "day" | "hour" | "minute" | "second",
  ): number => {
    const value = values.get(key);
    if (value === undefined) throw new Error(`Missing ${key} timezone part.`);
    return value;
  };
  return {
    year: required("year"),
    month: required("month"),
    day: required("day"),
    hour: required("hour"),
    minute: required("minute"),
    second: required("second"),
  };
}
