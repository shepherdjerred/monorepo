import { addDays, formatISO, parseISO } from "date-fns";

export const WEEKLY_PARLAY_TIMEZONE = "America/Los_Angeles";
export const WEEKLY_PARLAY_SLOT = 0;
export const WEEKLY_PARLAY_OPEN_HOUR = 12;
export const WEEKLY_PARLAY_BETTING_CLOSE_HOUR = 0;
export const WEEKLY_PARLAY_FINAL_HOUR = 11;
export const WEEKLY_PARLAY_UPDATE_HOUR = 19;
export const WEEKLY_PARLAY_UPDATE_COUNT = 6;

export type WeeklyParlayPeriod = {
  periodKey: string;
  openAt: Date;
  reminderAt: Date;
  bettingClosesAt: Date;
  scoringStartsAt: Date;
  updateAt: Date[];
  scoringEndsAt: Date;
  nextOpenAt: Date;
};

function calendarDate(date: Date): string {
  return formatISO(date, { representation: "date" });
}

function requiredPart(
  parts: ReadonlyMap<string, number>,
  key: "year" | "month" | "day" | "hour" | "minute" | "second",
): number {
  const value = parts.get(key);
  if (value === undefined) {
    throw new Error(`Missing ${key} timezone part.`);
  }
  return value;
}

/** Resolve a local Pacific wall time without assuming a fixed UTC offset. */
export function pacificWallTime(date: string, hour: number): Date {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(date);
  const groups = match?.groups;
  if (
    groups === undefined ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23
  ) {
    throw new Error(`Invalid Pacific wall time ${date} ${hour.toString()}:00.`);
  }
  const target = {
    year: Number(groups["year"]),
    month: Number(groups["month"]),
    day: Number(groups["day"]),
    hour,
  };
  let timestamp = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
  );
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: WEEKLY_PARLAY_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = new Map(
      formatter
        .formatToParts(new Date(timestamp))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const actualTimestamp = Date.UTC(
      requiredPart(parts, "year"),
      requiredPart(parts, "month") - 1,
      requiredPart(parts, "day"),
      requiredPart(parts, "hour"),
      requiredPart(parts, "minute"),
      requiredPart(parts, "second"),
    );
    const targetTimestamp = Date.UTC(
      target.year,
      target.month - 1,
      target.day,
      target.hour,
    );
    timestamp += targetTimestamp - actualTimestamp;
  }
  return new Date(timestamp);
}

function offsetDate(periodKey: string, days: number): string {
  return calendarDate(addDays(parseISO(periodKey), days));
}

/** Build the immutable clocks for a scoring period identified by its Monday. */
export function weeklyParlayPeriod(periodKey: string): WeeklyParlayPeriod {
  const monday = parseISO(periodKey);
  if (Number.isNaN(monday.getTime()) || monday.getDay() !== 1) {
    throw new Error(`Weekly parlay period ${periodKey} must be a Monday.`);
  }
  const openDate = offsetDate(periodKey, -1);
  const finalDate = offsetDate(periodKey, 6);
  return {
    periodKey,
    openAt: pacificWallTime(openDate, WEEKLY_PARLAY_OPEN_HOUR),
    reminderAt: pacificWallTime(openDate, WEEKLY_PARLAY_UPDATE_HOUR),
    bettingClosesAt: pacificWallTime(
      periodKey,
      WEEKLY_PARLAY_BETTING_CLOSE_HOUR,
    ),
    scoringStartsAt: pacificWallTime(
      periodKey,
      WEEKLY_PARLAY_BETTING_CLOSE_HOUR,
    ),
    updateAt: Array.from({ length: WEEKLY_PARLAY_UPDATE_COUNT }, (_, index) =>
      pacificWallTime(offsetDate(periodKey, index), WEEKLY_PARLAY_UPDATE_HOUR),
    ),
    scoringEndsAt: pacificWallTime(finalDate, WEEKLY_PARLAY_FINAL_HOUR),
    nextOpenAt: pacificWallTime(finalDate, WEEKLY_PARLAY_OPEN_HOUR),
  };
}

export function isWithinWeeklyScoringPeriod(
  completedAt: Date,
  period: Pick<WeeklyParlayPeriod, "scoringStartsAt" | "scoringEndsAt">,
): boolean {
  return (
    completedAt >= period.scoringStartsAt && completedAt < period.scoringEndsAt
  );
}
