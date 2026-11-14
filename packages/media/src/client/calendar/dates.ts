import { CalendarDateSchema } from "#shared/household/calendar.ts";

export function dateOnlyLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${CalendarDateSchema.parse(value)}T12:00:00Z`));
}
export function shiftCalendarDays(value: string, days: number) {
  const date = new Date(`${CalendarDateSchema.parse(value)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function calendarDays(
  anchor: string,
  view: "month" | "week" | "agenda",
) {
  const day = CalendarDateSchema.parse(anchor);
  if (view === "agenda")
    return Array.from({ length: 31 }, (_, index) =>
      shiftCalendarDays(day, index),
    );
  const start = view === "month" ? `${day.slice(0, 7)}-01` : day;
  const weekday = new Date(`${start}T12:00:00Z`).getUTCDay();
  return Array.from({ length: view === "month" ? 42 : 7 }, (_, index) =>
    shiftCalendarDays(start, index - weekday),
  );
}
export function localToday() {
  const date = new Date();
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
