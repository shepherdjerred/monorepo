import { ReportScheduleTimezoneSchema } from "@scout-for-lol/data/model/competitions/competition-cron.ts";
import { z } from "zod";

const CalendarDateSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/u,
    "Expected a calendar date in YYYY-MM-DD form.",
  );

type CalendarParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parseCalendarDate(value: string): CalendarParts {
  const parsed = CalendarDateSchema.parse(value);
  const [year, month, day] = parsed.split("-").map(Number);
  return z
    .object({
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
    })
    .transform((date) => ({ ...date, hour: 0, minute: 0, second: 0 }))
    .parse({ year, month, day });
}

function partsAt(date: Date, timezone: string): CalendarParts {
  const values = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: z.coerce.number().int().parse(values.get("year")),
    month: z.coerce.number().int().parse(values.get("month")),
    day: z.coerce.number().int().parse(values.get("day")),
    hour: z.coerce.number().int().parse(values.get("hour")),
    minute: z.coerce.number().int().parse(values.get("minute")),
    second: z.coerce.number().int().parse(values.get("second")),
  };
}

function utcValue(parts: CalendarParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function localMidnight(value: string, timezone: string): Date {
  const zone = ReportScheduleTimezoneSchema.parse(timezone);
  const wanted = parseCalendarDate(value);
  let candidate = new Date(utcValue(wanted));
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const observed = partsAt(candidate, zone);
    const delta = utcValue(wanted) - utcValue(observed);
    if (delta === 0) break;
    candidate = new Date(candidate.getTime() + delta);
  }
  if (utcValue(partsAt(candidate, zone)) !== utcValue(wanted)) {
    throw new Error(`Calendar date ${value} has no midnight in ${zone}.`);
  }
  return candidate;
}

export function browserTimezone(): string {
  return ReportScheduleTimezoneSchema.parse(
    new Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
}

export function calendarDateInTimezone(date: Date, timezone: string): string {
  const parts = partsAt(date, ReportScheduleTimezoneSchema.parse(timezone));
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

export function addCalendarDays(value: string, days: number): string {
  const parts = parseCalendarDate(value);
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

export function fixedDateRangeInTimezone(
  startDate: string,
  endDate: string,
  timezone: string,
): { startDate: Date; endDate: Date } {
  const start = localMidnight(startDate, timezone);
  const nextDay = addCalendarDays(endDate, 1);
  const end = new Date(localMidnight(nextDay, timezone).getTime() - 1);
  return { startDate: start, endDate: end };
}
