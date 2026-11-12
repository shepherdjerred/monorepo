/**
 * Calendar days, `YYYY-MM-DD`, as the server stores a due date. Everything
 * here is arithmetic on year, month and day numbers: nothing passes through
 * a timestamp, so a day never shifts across a time zone or a DST change.
 * "Today" is read once from the browser's local clock.
 */
export type CalendarDay = string;
type Parts = { year: number; month: number; day: number };

const pad = (value: number, width: number) =>
  String(value).padStart(width, "0");

export function toDay({ year, month, day }: Parts): CalendarDay {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

const dayPattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function daysInMonth(year: number, month: number) {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** The parts of a day; undefined for text that is not a real calendar day. */
export function parseDay(value: string): Parts | undefined {
  const match = dayPattern.exec(value);
  if (match === null) {
    return undefined;
  }
  const [, year = "", month = "", day = ""] = match;
  const parts = { year: Number(year), month: Number(month), day: Number(day) };
  return parts.year >= 1 &&
    parts.month >= 1 &&
    parts.month <= 12 &&
    parts.day >= 1 &&
    parts.day <= daysInMonth(parts.year, parts.month)
    ? parts
    : undefined;
}

function partsOf(value: CalendarDay): Parts {
  const parts = parseDay(value);
  if (parts === undefined) {
    throw new Error(`${value} is not a calendar day`);
  }
  return parts;
}

/** Days since 1970-01-01 in the proleptic Gregorian calendar. */
export function dayNumber(value: CalendarDay) {
  const { year, month, day } = partsOf(value);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

export function fromDayNumber(count: number): CalendarDay {
  const shifted = count + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex + (monthIndex < 10 ? 3 : -9);
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return toDay({ year, month, day });
}

export const addDays = (value: CalendarDay, count: number) =>
  fromDayNumber(dayNumber(value) + count);

export const daysBetween = (from: CalendarDay, to: CalendarDay) =>
  dayNumber(to) - dayNumber(from);

/** The same day `count` months on, clamped to the end of a shorter month. */
export function addMonths(value: CalendarDay, count: number): CalendarDay {
  const { year, month, day } = partsOf(value);
  const index = year * 12 + (month - 1) + count;
  const nextYear = Math.floor(index / 12);
  const nextMonth = index - nextYear * 12 + 1;
  return toDay({
    year: nextYear,
    month: nextMonth,
    day: Math.min(day, daysInMonth(nextYear, nextMonth)),
  });
}

/** 0 for Sunday through 6 for Saturday; 1970-01-01 was a Thursday. */
export const weekday = (value: CalendarDay) =>
  (((dayNumber(value) + 4) % 7) + 7) % 7;

/** Weeks start on Monday, as ISO 8601 has them. */
export const startOfWeek = (value: CalendarDay) =>
  addDays(value, -((weekday(value) + 6) % 7));
export const endOfWeek = (value: CalendarDay) => addDays(startOfWeek(value), 6);

/** The browser's calendar day, read from its local clock. */
export function localToday(now: Date = new Date()): CalendarDay {
  return toDay({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  });
}

/** The next `target` weekday on or after `from`. */
export const nextWeekday = (from: CalendarDay, target: number) =>
  addDays(from, (target - weekday(from) + 7) % 7);

export type QuickChoice = { id: string; label: string; day: CalendarDay };

/** The choices a due date picker offers first, as Linear's do. */
export function quickChoices(today: CalendarDay): QuickChoice[] {
  return [
    { id: "today", label: "Today", day: today },
    { id: "tomorrow", label: "Tomorrow", day: addDays(today, 1) },
    { id: "friday", label: "This Friday", day: nextWeekday(today, 5) },
    {
      id: "monday",
      label: "Next Monday",
      day: nextWeekday(addDays(today, 1), 1),
    },
    { id: "week", label: "In 1 week", day: addDays(today, 7) },
    { id: "two-weeks", label: "In 2 weeks", day: addDays(today, 14) },
  ];
}

/**
 * A date at local noon, only ever handed to `Intl` for display. Noon keeps
 * the calendar day whatever DST does to the hours around midnight.
 */
export function displayDate(value: CalendarDay) {
  const { year, month, day } = partsOf(value);
  const date = new Date(2000, month - 1, day, 12);
  date.setFullYear(year);
  return date;
}
