import {
  addDays,
  differenceInCalendarDays,
  formatISO,
  parseISO,
} from "date-fns";
import { POLLING_INTERVALS } from "@scout-for-lol/data/polling-config.ts";
import { WEEKLY_PARLAY_LIFECYCLE } from "@scout-for-lol/data/model/bucks/weekly-parlay.ts";

export const WEEKLY_PARLAY_TIMEZONE = WEEKLY_PARLAY_LIFECYCLE.timezone;
export const WEEKLY_PARLAY_SLOT = WEEKLY_PARLAY_LIFECYCLE.slot;
export const WEEKLY_PARLAY_OPEN_HOUR = WEEKLY_PARLAY_LIFECYCLE.openHour;
export const WEEKLY_PARLAY_BETTING_CLOSE_HOUR =
  WEEKLY_PARLAY_LIFECYCLE.bettingCloseHour;
export const WEEKLY_PARLAY_FINAL_HOUR = WEEKLY_PARLAY_LIFECYCLE.finalHour;
export const WEEKLY_PARLAY_UPDATE_HOUR = WEEKLY_PARLAY_LIFECYCLE.updateHour;
export const WEEKLY_PARLAY_UPDATE_COUNT = WEEKLY_PARLAY_LIFECYCLE.updateCount;
export const WEEKLY_PARLAY_CATCHUP_MINIMUM_BETTING_HOURS =
  WEEKLY_PARLAY_LIFECYCLE.catchupMinimumBettingHours;
const WEEKLY_PARLAY_INGESTION_POLL_WINDOWS = 2;
export const WEEKLY_PARLAY_INGESTION_GRACE_MINUTES =
  POLLING_INTERVALS.MAX * WEEKLY_PARLAY_INGESTION_POLL_WINDOWS;
export const WEEKLY_PARLAY_INGESTION_GRACE_MS =
  WEEKLY_PARLAY_INGESTION_GRACE_MINUTES * 60_000;

export function weeklyParlayWallClockLabel(hour: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(
      `Invalid weekly parlay wall-clock hour ${hour.toString()}.`,
    );
  }
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour.toString()}:00 ${hour < 12 ? "AM" : "PM"}`;
}

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

export type WeeklyParlayFrozenWindow = {
  periodKey: string;
  openAt: Date;
  bettingClosesAt: Date;
  scoringStartsAt: Date;
  scoringEndsAt: Date;
};

export type WeeklyParlayRuntimeTimeline = WeeklyParlayFrozenWindow & {
  reminderAt?: Date;
  updateAt: Date[];
};

export type WeeklyParlayScoringShape = {
  startDayOffset: number;
  startHour: number;
  endDayOffset: number;
  endHour: number;
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

function pacificDateAndHour(instant: Date): { date: string; hour: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: WEEKLY_PARLAY_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  });
  const parts = new Map(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  const hour = parts.get("hour");
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined
  ) {
    throw new Error("Could not derive Pacific weekly parlay time parts.");
  }
  return { date: `${year}-${month}-${day}`, hour: Number(hour) };
}

export function weeklyParlayScoringShape(
  window: Pick<
    WeeklyParlayFrozenWindow,
    "periodKey" | "scoringStartsAt" | "scoringEndsAt"
  >,
): WeeklyParlayScoringShape {
  weeklyParlayPeriod(window.periodKey);
  const start = pacificDateAndHour(window.scoringStartsAt);
  const end = pacificDateAndHour(window.scoringEndsAt);
  return {
    startDayOffset: differenceInCalendarDays(
      parseISO(start.date),
      parseISO(window.periodKey),
    ),
    startHour: start.hour,
    endDayOffset: differenceInCalendarDays(
      parseISO(end.date),
      parseISO(window.periodKey),
    ),
    endHour: end.hour,
  };
}

export function weeklyParlayScoringWindowForPeriod(
  periodKey: string,
  shape: WeeklyParlayScoringShape,
): Pick<WeeklyParlayFrozenWindow, "scoringStartsAt" | "scoringEndsAt"> {
  weeklyParlayPeriod(periodKey);
  return {
    scoringStartsAt: pacificWallTime(
      offsetDate(periodKey, shape.startDayOffset),
      shape.startHour,
    ),
    scoringEndsAt: pacificWallTime(
      offsetDate(periodKey, shape.endDayOffset),
      shape.endHour,
    ),
  };
}

export function weeklyParlayTimelineFromWindow(
  window: WeeklyParlayFrozenWindow,
): WeeklyParlayRuntimeTimeline {
  weeklyParlayPeriod(window.periodKey);
  const dailyUpdates = Array.from({ length: 7 }, (_, dayOffset) =>
    pacificWallTime(
      offsetDate(window.periodKey, dayOffset),
      WEEKLY_PARLAY_UPDATE_HOUR,
    ),
  );
  const reminderAt = [
    pacificWallTime(
      offsetDate(window.periodKey, -1),
      WEEKLY_PARLAY_UPDATE_HOUR,
    ),
    ...dailyUpdates,
  ].findLast(
    (candidate) =>
      candidate > window.openAt && candidate < window.bettingClosesAt,
  );
  return {
    ...window,
    ...(reminderAt === undefined ? {} : { reminderAt }),
    updateAt: dailyUpdates.filter(
      (candidate) =>
        candidate >= window.scoringStartsAt && candidate < window.scoringEndsAt,
    ),
  };
}

export function isWeeklyParlayCatchupTimeline(
  window: WeeklyParlayFrozenWindow,
): boolean {
  const standard = weeklyParlayPeriod(window.periodKey);
  return (
    window.openAt.getTime() !== standard.openAt.getTime() ||
    window.bettingClosesAt.getTime() !== standard.bettingClosesAt.getTime() ||
    window.scoringStartsAt.getTime() !== standard.scoringStartsAt.getTime() ||
    window.scoringEndsAt.getTime() !== standard.scoringEndsAt.getTime()
  );
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

export function weeklyParlayFinalSettlementAt(scoringEndsAt: Date): Date {
  return new Date(scoringEndsAt.getTime() + WEEKLY_PARLAY_INGESTION_GRACE_MS);
}
