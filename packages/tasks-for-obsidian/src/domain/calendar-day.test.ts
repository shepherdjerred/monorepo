import { describe, expect, test } from "bun:test";

import { CalendarDaySchema, calendarDayOrNull } from "./calendar-day";

describe("CalendarDaySchema", () => {
  test("accepts a real local calendar day", () => {
    expect(CalendarDaySchema.parse("2026-08-07")).toBe("2026-08-07");
  });

  test("rejects impossible and noncanonical calendar days", () => {
    expect(CalendarDaySchema.safeParse("2026-02-30").success).toBe(false);
    expect(CalendarDaySchema.safeParse("2026-8-7").success).toBe(false);
  });
});

describe("calendarDayOrNull", () => {
  test("turns malformed external route values into a safe empty selection", () => {
    expect(calendarDayOrNull("2026-02-30")).toBeNull();
    expect(calendarDayOrNull(undefined)).toBeNull();
    expect(calendarDayOrNull("2026-08-07")).toBe("2026-08-07");
  });
});
