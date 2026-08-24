import { describe, expect, test } from "vitest";
import {
  addCalendarDays,
  calendarDateInTimezone,
  fixedDateRangeInTimezone,
} from "#src/lib/competition-time.ts";

describe("competition calendar time", () => {
  test("uses local day start and inclusive local day end", () => {
    const range = fixedDateRangeInTimezone(
      "2026-08-23",
      "2026-08-24",
      "America/Los_Angeles",
    );
    expect(range.startDate.toISOString()).toBe("2026-08-23T07:00:00.000Z");
    expect(range.endDate.toISOString()).toBe("2026-08-25T06:59:59.999Z");
  });

  test("keeps the spring DST boundary on local calendar days", () => {
    const range = fixedDateRangeInTimezone(
      "2026-03-08",
      "2026-03-08",
      "America/Los_Angeles",
    );
    expect(range.startDate.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(range.endDate.toISOString()).toBe("2026-03-09T06:59:59.999Z");
  });

  test("keeps the fall DST boundary on local calendar days", () => {
    const range = fixedDateRangeInTimezone(
      "2026-11-01",
      "2026-11-01",
      "America/Los_Angeles",
    );
    expect(range.startDate.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(range.endDate.toISOString()).toBe("2026-11-02T07:59:59.999Z");
  });

  test("formats and advances calendar dates without UTC drift", () => {
    expect(
      calendarDateInTimezone(
        new Date("2026-01-01T01:00:00.000Z"),
        "America/Los_Angeles",
      ),
    ).toBe("2025-12-31");
    expect(addCalendarDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
