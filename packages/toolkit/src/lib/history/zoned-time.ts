/**
 * Calendar arithmetic in an IANA time zone, using only `Intl`. Calendar dates
 * are plain `{year, month, day}` values; an instant maps to the date its wall
 * clock shows in the zone, and a date maps back to the instant its midnight
 * begins, which is how DST days get their 23 or 25 hours.
 */

export type CalendarDate = {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  readonly day: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (cached === undefined) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

/** The zone's canonical name, or null when `Intl` does not know it. */
export function canonicalTimeZone(timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

/** The process's local zone, which is the daemon's default. */
export function localTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

type WallClock = CalendarDate & {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
};

function wallClock(instantMs: number, timeZone: string): WallClock {
  const fields = new Map(
    formatter(timeZone)
      .formatToParts(new Date(instantMs))
      .map((part) => [part.type, Number(part.value)]),
  );
  const field = (name: Intl.DateTimeFormatPartTypes): number => {
    const value = fields.get(name);
    if (value === undefined || Number.isNaN(value)) {
      throw new Error(`Intl returned no ${name} for ${timeZone}`);
    }
    return value;
  };
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    hour: field("hour"),
    minute: field("minute"),
    second: field("second"),
  };
}

/** The zone's UTC offset at an instant (positive east of UTC). */
function offsetMs(instantMs: number, timeZone: string): number {
  const wall = wallClock(instantMs, timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

export function calendarDateOf(
  instantMs: number,
  timeZone: string,
): CalendarDate {
  const { year, month, day } = wallClock(instantMs, timeZone);
  return { year, month, day };
}

/** The instant the date's midnight begins in the zone. */
export function zonedMidnight(date: CalendarDate, timeZone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day);
  // Two passes settle the offset: the first guess uses the offset at the
  // wall time read as UTC, which can sit on the other side of a transition.
  const first = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(first, timeZone);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(
    Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS,
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** 0 is Sunday. */
export function weekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatCalendarMonth(date: CalendarDate): string {
  return `${String(date.year)}-${pad(date.month)}`;
}

export function formatCalendarDate(date: CalendarDate): string {
  return `${formatCalendarMonth(date)}-${pad(date.day)}`;
}

/** A `YYYY-MM-DD` string as a date, or null when it is not one. */
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) {
    return null;
  }
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const roundTrip = addDays(date, 0);
  return roundTrip.month === date.month && roundTrip.day === date.day
    ? date
    : null;
}
