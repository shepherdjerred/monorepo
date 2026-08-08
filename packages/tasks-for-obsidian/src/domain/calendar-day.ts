import { z } from "zod";

export const CalendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealLocalDate, { message: "Expected a valid YYYY-MM-DD date" });

export function calendarDayOrNull(value: unknown): string | null {
  const parsed = CalendarDaySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isRealLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined
  ) {
    throw new Error("Calendar day regex did not return its documented groups");
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}
