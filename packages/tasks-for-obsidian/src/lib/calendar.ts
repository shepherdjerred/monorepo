import { parseLocalDate, toISODate } from "./dates";

/** A calendar month; `month` is 0-indexed like the Date API. */
export type CalendarMonth = {
  readonly year: number;
  readonly month: number;
};

export const WEEKDAYS = [
  { key: "sun", label: "S" },
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
];

/** One grid cell: `ymd` is null for padding days outside the month. */
export type CalendarCell = {
  readonly key: string;
  readonly ymd: string | null;
};

export function monthOf(ymd: string): CalendarMonth {
  const d = parseLocalDate(ymd);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function currentMonth(now = new Date()): CalendarMonth {
  return { year: now.getFullYear(), month: now.getMonth() };
}

export function addMonths(m: CalendarMonth, delta: number): CalendarMonth {
  const d = new Date(m.year, m.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function monthTitle(m: CalendarMonth): string {
  return new Date(m.year, m.month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/**
 * The month as Sunday-started weeks of cells, with leading and trailing days
 * outside the month as null-`ymd` padding. Always whole weeks (rows of 7).
 * Cell keys are stable and unique within the month (grid position).
 */
export function monthGrid(m: CalendarMonth): CalendarCell[][] {
  const firstWeekday = new Date(m.year, m.month, 1).getDay();
  const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();

  const cells: CalendarCell[] = [];
  const pad = (): void => {
    cells.push({ key: `${m.year}-${m.month}-pad-${cells.length}`, ymd: null });
  };
  for (let i = 0; i < firstWeekday; i += 1) pad();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const ymd = toISODate(new Date(m.year, m.month, day));
    cells.push({ key: ymd, ymd });
  }
  while (cells.length % 7 !== 0) pad();

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}
