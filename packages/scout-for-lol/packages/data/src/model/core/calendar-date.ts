import { z } from "zod";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * YYYY-MM-DD that round-trips as a real UTC calendar date.
 *
 * Shape-valid strings like `2026-13-40` or `2026-02-30` pass a regex but are
 * not real dates; consumers would then build an invalid Date or silently
 * normalize (Feb 30 → March). Reject by reconstructing the UTC date.
 */
export const DateOnlySchema = z
  .string()
  .regex(DATE_ONLY_REGEX, "expected a YYYY-MM-DD calendar date")
  .refine((value) => {
    const parts = value.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "expected a real calendar date (valid month 01-12 and day for that month)");

export function calendarDateInTimeZone(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(
      `Could not format ${at.toISOString()} as a calendar date in ${timeZone}`,
    );
  }
  return `${year}-${month}-${day}`;
}
