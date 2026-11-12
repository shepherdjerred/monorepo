import {
  addDays,
  addMonths,
  daysInMonth,
  displayDate,
  nextWeekday,
  parseDay,
  startOfWeek,
  toDay,
  type CalendarDay,
} from "./dates.ts";

const englishWeekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const englishMonths = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Month names in English and in the browser's language, lower case. */
function localMonthNames(locale: string | undefined) {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => {
    const date = displayDate(toDay({ year: 2001, month, day: 1 }));
    return [
      new Intl.DateTimeFormat(locale, { month: "long" }).format(date),
      new Intl.DateTimeFormat(locale, { month: "short" }).format(date),
    ].map((name) => name.toLowerCase().replace(/\.$/u, ""));
  });
}

/** A month or weekday named in full or by any prefix of three letters or more. */
function nameIndex(word: string, names: readonly (readonly string[])[]) {
  return word.length < 3
    ? -1
    : names.findIndex((aliases) =>
        aliases.some((name) => name.startsWith(word) || word === name),
      );
}

const unitDays = { d: 1, w: 7 } as const;
const offsetPattern =
  /^(?:in\s+|\+)?(\d{1,3})\s*([dmw]|days?|weeks?|wk|months?|mo)(?:\s+from\s+now)?$/u;

function offset(text: string, today: CalendarDay) {
  const match = offsetPattern.exec(text);
  if (match === null) {
    return;
  }
  const [, amount = "0", unit = "d"] = match;
  const count = Number(amount);
  if (unit.startsWith("m")) {
    return addMonths(today, count);
  }
  return addDays(today, count * unitDays[unit.startsWith("w") ? "w" : "d"]);
}

function relativeWord(text: string, today: CalendarDay) {
  switch (text) {
    case "today":
    case "tod":
    case "now": {
      return today;
    }
    case "tomorrow":
    case "tmr":
    case "tmrw":
    case "tom": {
      return addDays(today, 1);
    }
    case "yesterday": {
      return addDays(today, -1);
    }
    case "next week": {
      return addDays(startOfWeek(today), 7);
    }
    case "next month": {
      return addMonths(today, 1);
    }
    case "end of week":
    case "eow": {
      return addDays(startOfWeek(today), 6);
    }
    case "end of month":
    case "eom": {
      const [year = "0", month = "0"] = today.split("-");
      return toDay({
        year: Number(year),
        month: Number(month),
        day: daysInMonth(Number(year), Number(month)),
      });
    }
  }
  return;
}

function weekdayName(text: string, today: CalendarDay) {
  const match = /^(next\s+|this\s+)?([a-z]+)$/u.exec(text);
  if (match === null) {
    return;
  }
  const [, qualifier, word = ""] = match;
  const index = nameIndex(
    word,
    englishWeekdays.map((name) => [name]),
  );
  if (index === -1) {
    return;
  }
  // "next friday" is the Friday of next week; "friday" the coming one.
  return qualifier?.trim() === "next"
    ? nextWeekday(addDays(startOfWeek(today), 7), index)
    : nextWeekday(today, index);
}

/** "jan 15", "15 january", "jan 15 2027": the next such day unless a year is given. */
function monthDay(text: string, today: CalendarDay, locale?: string) {
  const match =
    /^(?:(\p{L}+)\.?\s+(\d{1,2})|(\d{1,2})\s+(\p{L}+)\.?)(?:,?\s+(\d{4}))?$/u.exec(
      text,
    );
  if (match === null) {
    return;
  }
  const [, monthFirst, dayFirst, dayAfter, monthAfter, yearText] = match;
  const names = englishMonths.map((name, index) => [
    name,
    ...(localMonthNames(locale)[index] ?? []),
  ]);
  const month = nameIndex(monthFirst ?? monthAfter ?? "", names) + 1;
  const day = Number(dayFirst ?? dayAfter);
  if (month === 0) {
    return;
  }
  const thisYear = Number(today.slice(0, 4));
  const build = (year: number) =>
    day <= daysInMonth(year, month) ? toDay({ year, month, day }) : undefined;
  if (yearText !== undefined) {
    return build(Number(yearText));
  }
  const candidate = build(thisYear);
  // A day already past this year means the next one; 29 February waits
  // for the next leap year.
  if (candidate !== undefined && candidate >= today) {
    return candidate;
  }
  for (let year = thisYear + 1; year <= thisYear + 8; year += 1) {
    const next = build(year);
    if (next !== undefined) {
      return next;
    }
  }
  return;
}

/**
 * Read a due date typed in words: "today", "tomorrow", "fri", "next week",
 * "jan 15", "2026-12-01", "+3d", "in 2 weeks". Undefined when the text is
 * not a date this understands.
 */
export function parseDue(
  input: string,
  today: CalendarDay,
  locale?: string,
): CalendarDay | undefined {
  const text = input.trim().toLowerCase().replaceAll(/\s+/gu, " ");
  if (text === "") {
    return;
  }
  return parseDay(text) === undefined
    ? (relativeWord(text, today) ??
        offset(text, today) ??
        weekdayName(text, today) ??
        monthDay(text, today, locale))
    : text;
}
