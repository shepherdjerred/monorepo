import type { ActivityGroup } from "@shepherdjerred/storm-stats/shared/contract.ts";

export const PACIFIC_TIME_ZONE = "America/Los_Angeles" as const;

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;
const WEEKLY_ACTIVITY_THRESHOLD_MS = 2 * HOUR_MS; // 7,200,000 ms (2 hours/week)

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const pacificFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

export type PacificDateParts = {
  readonly day: string;
  /** 0 = Monday .. 6 = Sunday in America/Los_Angeles */
  readonly dayOfWeek: number;
  /** 0 .. 23 in America/Los_Angeles */
  readonly hour: number;
};

export function toPacificParts(
  input: Date | number | string,
): PacificDateParts {
  const date = input instanceof Date ? input : new Date(input);
  const byType = new Map(
    pacificFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const year = byType.get("year") ?? "1970";
  const month = byType.get("month") ?? "01";
  const day = byType.get("day") ?? "01";
  const weekday = byType.get("weekday") ?? "Thu";
  const hourRaw = byType.get("hour") ?? "00";
  const dayOfWeek = WEEKDAY_INDEX[weekday] ?? 0;
  const hour = Number(hourRaw) % 24;
  return {
    day: `${year}-${month}-${day}`,
    dayOfWeek,
    hour,
  };
}

export function toPacificDay(input: Date | number | string): string {
  return toPacificParts(input).day;
}

function parseCalendarDayUtc(day: string): number {
  const parts = day.split("-");
  const year = Number(parts[0] ?? "1970");
  const month = Number(parts[1] ?? "1");
  const date = Number(parts[2] ?? "1");
  return Date.UTC(year, month - 1, date);
}

function formatCalendarDayUtc(utcMs: number): string {
  const d = new Date(utcMs);
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addCalendarDays(day: string, deltaDays: number): string {
  const baseUtc = parseCalendarDayUtc(day);
  return formatCalendarDayUtc(baseUtc + deltaDays * DAY_MS);
}

/** 0 = Monday .. 6 = Sunday for a YYYY-MM-DD calendar date. */
export function dayOfWeekForCalendarDay(day: string): number {
  const utcDate = new Date(parseCalendarDayUtc(day));
  return (utcDate.getUTCDay() + 6) % 7;
}

export function mondayOfCalendarDay(day: string): string {
  return addCalendarDays(day, -dayOfWeekForCalendarDay(day));
}

/**
 * Builds an ascending, inclusive, zero-gap array of `count` YYYY-MM-DD days
 * ending on `endDay`.
 */
export function buildCalendarDaySeries(
  endDay: string,
  count: number,
): string[] {
  const result: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    result.push(addCalendarDays(endDay, -offset));
  }
  return result;
}

export function round2(value: number): number {
  return !Number.isFinite(value) || value <= 0
    ? 0
    : Math.round(value * 100) / 100;
}

export function msToHours(ms: number): number {
  return round2(ms / HOUR_MS);
}

export function msToMinutes(ms: number): number {
  return round2(ms / MINUTE_MS);
}

export function safePercent(numerator: number, denominator: number): number {
  return denominator <= 0 || numerator <= 0
    ? 0
    : Math.min(100, round2((numerator / denominator) * 100));
}

export function computeKdr(kills: number, deaths: number): number {
  if (kills <= 0) {
    return 0;
  }
  return deaths <= 0 ? round2(kills) : round2(kills / deaths);
}

function scoreSingleWeek(activeMs: number): number {
  return activeMs <= 0
    ? 0
    : 5 /
        (1 + Math.PI * (WEEKLY_ACTIVITY_THRESHOLD_MS / Math.max(activeMs, 1)));
}

/**
 * Plan's 3-week weighted active playtime index in [0, 5]:
 * - T = 2 hours (7,200,000 ms) per 7-day window
 * - s_i = 5 / (1 + pi * (T / max(activeMs_i, 1))) for activeMs_i > 0, else 0
 * - index = (3 * s_0 + 2 * s_1 + 1 * s_2) / 6, clamped and rounded to 2 decimals.
 */
export function computeActivityIndex(
  w0ActiveMs: number,
  w1ActiveMs: number,
  w2ActiveMs: number,
): { readonly activityIndex: number; readonly activityGroup: ActivityGroup } {
  const s0 = scoreSingleWeek(w0ActiveMs);
  const s1 = scoreSingleWeek(w1ActiveMs);
  const s2 = scoreSingleWeek(w2ActiveMs);
  const weighted = (3 * s0 + 2 * s1 + s2) / 6;
  const clamped = Math.min(5, Math.max(0, weighted));
  const activityIndex = Math.round(clamped * 100) / 100;

  let activityGroup: ActivityGroup = "inactive";
  if (activityIndex >= 3.5) {
    activityGroup = "regular";
  } else if (activityIndex >= 1.75) {
    activityGroup = "active";
  } else if (activityIndex >= 0.5) {
    activityGroup = "irregular";
  }

  return { activityIndex, activityGroup };
}
