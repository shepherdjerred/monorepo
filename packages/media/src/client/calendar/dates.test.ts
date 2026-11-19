import { expect, test } from "vitest";
import { calendarDays, dateOnlyLabel, shiftCalendarDays } from "./dates.ts";

test("civil dates retain their day across DST and month boundaries", () => {
  expect(shiftCalendarDays("2026-11-01", 1)).toBe("2026-11-02");
  expect(shiftCalendarDays("2026-03-08", 1)).toBe("2026-03-09");
  expect(shiftCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
  expect(dateOnlyLabel("2026-11-13")).toContain("13");
});
test("calendar month and week include whole Sunday-Saturday rows", () => {
  const month = calendarDays("2026-11-13", "month");
  expect(month).toHaveLength(42);
  expect(month[0]).toBe("2026-11-01");
  expect(month.at(-1)).toBe("2026-12-12");
  expect(calendarDays("2026-11-13", "week")).toEqual([
    "2026-11-08",
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
    "2026-11-14",
  ]);
});
