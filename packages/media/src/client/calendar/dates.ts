import { CalendarDateSchema } from "#shared/household/calendar.ts";

/*
 * Calendar arithmetic on civil dates.
 *
 * A release date is a day on a calendar, not a moment: "November 14" is the
 * same square for a reader in Tokyo and one in Seattle. So a date here is
 * the `YYYY-MM-DD` text the API sends and stays that text. Nothing in this
 * file builds a `Date` from the viewer's clock except `localToday`, which
 * asks the one question that does depend on where the viewer is.
 *
 * The arithmetic counts days in UTC, which has no daylight saving time, so a
 * day is always 86,400,000 ms and adding one never lands on the same date or
 * skips one. `Temporal.PlainDate` is the platform's type for this, but it is
 * not Baseline yet.
 */

/** A calendar day, `YYYY-MM-DD`. */
export type CivilDate = string;
/** A calendar month, `YYYY-MM`. */
export type CivilMonth = string;

const DAY_MS = 86_400_000;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** The UTC midnight that stands for a civil date in arithmetic. */
function dayNumber(date: CivilDate): number {
  const [year = 0, month = 1, day = 1] = CalendarDateSchema.parse(date)
    .split("-")
    .map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromDayNumber(value: number): CivilDate {
  return new Date(value).toISOString().slice(0, 10);
}

/** The viewer's own date today, by their clock and time zone. */
export function localToday(now: Date = new Date()): CivilDate {
  return `${String(now.getFullYear())}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
}

export function shiftDays(date: CivilDate, days: number): CivilDate {
  return fromDayNumber(dayNumber(date) + days * DAY_MS);
}

/** Sunday is 0, as in the grid's first column. */
function weekday(date: CivilDate): number {
  return new Date(dayNumber(date)).getUTCDay();
}

/** The month a typed or linked address names, or null when it names none. */
export function parseMonth(value: string | null): CivilMonth | null {
  return value !== null && MONTH.test(value) ? value : null;
}

/** A whole civil date from an address or a date field, or null. */
export function parseDate(value: string | null): CivilDate | null {
  const parsed = CalendarDateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function monthOf(date: CivilDate): CivilMonth {
  return date.slice(0, 7);
}

export function firstDay(month: CivilMonth): CivilDate {
  return `${month}-01`;
}

export function shiftMonth(month: CivilMonth, months: number): CivilMonth {
  const [year = 0, index = 1] = month.split("-").map(Number);
  const total = year * 12 + (index - 1) + months;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${twoDigits((total % 12) + 1)}`;
}

export function lastDay(month: CivilMonth): CivilDate {
  return shiftDays(firstDay(shiftMonth(month, 1)), -1);
}

/**
 * The same day of another month, or that month's last day when it is
 * shorter: a month on from January 31 is the end of February.
 */
export function shiftMonthOfDate(date: CivilDate, months: number): CivilDate {
  const month = shiftMonth(monthOf(date), months);
  const wanted = `${month}-${date.slice(8)}`;
  const last = lastDay(month);
  // Dates in this form sort as text.
  return wanted.localeCompare(last) > 0 ? last : wanted;
}

/** Every day of a month, first to last. */
export function monthDays(month: CivilMonth): CivilDate[] {
  const first = firstDay(month);
  const count = Number(lastDay(month).slice(8));
  return Array.from({ length: count }, (_, index) => shiftDays(first, index));
}

/**
 * A month as the rows of a wall calendar: whole Sunday-to-Saturday weeks,
 * from the week holding the 1st to the week holding the last day. The first
 * and last rows carry the neighbouring months' days.
 */
export function monthWeeks(month: CivilMonth): CivilDate[][] {
  const first = firstDay(month);
  const last = lastDay(month);
  const start = shiftDays(first, -weekday(first));
  const end = shiftDays(last, 6 - weekday(last));
  const weeks: CivilDate[][] = [];
  for (let day = start; day <= end; day = shiftDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => shiftDays(day, index)));
  }
  return weeks;
}

/** The Sunday and Saturday of a date's week. */
export function weekEnds(date: CivilDate): {
  start: CivilDate;
  end: CivilDate;
} {
  const start = shiftDays(date, -weekday(date));
  return { start, end: shiftDays(start, 6) };
}

/** The seven days of the week containing this date, Sunday first. */
export function weekDays(date: CivilDate): CivilDate[] {
  const { start } = weekEnds(date);
  return Array.from({ length: 7 }, (_, index) => shiftDays(start, index));
}

/*
 * Words. A civil date is formatted as the UTC midnight that stands for it,
 * in UTC, so the words name the date itself whatever the viewer's zone.
 */

function formatted(
  date: CivilDate,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: "UTC",
  }).format(new Date(dayNumber(date)));
}

/** "November 2026". */
export function monthLabel(month: CivilMonth, locale?: string): string {
  return formatted(firstDay(month), { month: "long", year: "numeric" }, locale);
}

/** The first and last dates of a week, with both years when they differ. */
export function weekLabel(date: CivilDate, locale?: string): string {
  const { start, end } = weekEnds(date);
  const year = { year: "numeric" } as const;
  const first = formatted(
    start,
    {
      month: "short",
      day: "numeric",
      ...(start.slice(0, 4) === end.slice(0, 4) ? {} : year),
    },
    locale,
  );
  const last = formatted(
    end,
    { month: "short", day: "numeric", ...year },
    locale,
  );
  return `${first} – ${last}`;
}

/** "Saturday, November 14". */
export function dayLabel(date: CivilDate, locale?: string): string {
  return formatted(
    date,
    { weekday: "long", month: "long", day: "numeric" },
    locale,
  );
}

/** "Sat", for the gutter beside an agenda day. */
export function weekdayShort(date: CivilDate, locale?: string): string {
  return formatted(date, { weekday: "short" }, locale);
}

/** "Nov", for a day of a neighbouring month that needs saying which. */
export function monthShort(date: CivilDate, locale?: string): string {
  return formatted(date, { month: "short" }, locale);
}

/** The day of the month as a number: 14. */
export function dayOfMonth(date: CivilDate): number {
  return Number(date.slice(8));
}

/** The seven column heads, Sunday first, long ("Sunday") and short ("Sun"). */
export function weekdayNames(
  locale?: string,
): { long: string; short: string }[] {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, index) => {
    const day = shiftDays("2023-01-01", index);
    return {
      long: formatted(day, { weekday: "long" }, locale),
      short: formatted(day, { weekday: "short" }, locale),
    };
  });
}
