import { describe, expect, test } from "vitest";
import {
  addDays,
  civilDayOfInstant,
  dayHeading,
  effectiveCivilDay,
  isCivilDay,
  today,
} from "./civil-day.ts";

describe("civil days", () => {
  test("adds days across a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("rejects a calendar day that does not exist", () => {
    expect(isCivilDay("2026-02-31")).toBe(false);
    expect(isCivilDay("2026-11-25")).toBe(true);
  });

  test("reads an instant in the viewer time zone", () => {
    expect(
      civilDayOfInstant("2026-11-25T07:30:00.000Z", "America/Los_Angeles"),
    ).toBe("2026-11-24");
    expect(
      civilDayOfInstant("2026-11-25T08:30:00.000Z", "America/Los_Angeles"),
    ).toBe("2026-11-25");
  });

  test("prefers a due instant over a stored civil day", () => {
    expect(
      effectiveCivilDay(
        {
          due_date: "2026-11-25",
          due_datetime: "2026-11-25T07:30:00.000Z",
        },
        "America/Los_Angeles",
      ),
    ).toBe("2026-11-24");
    expect(effectiveCivilDay({ due_date: "2026-11-25T00:00:00" }, "UTC")).toBe(
      "2026-11-25",
    );
  });

  test("names today and tomorrow", () => {
    expect(today("UTC", new Date("2026-11-25T15:00:00.000Z"))).toBe(
      "2026-11-25",
    );
    expect(dayHeading("2026-11-25", "2026-11-25")).toBe("Today · Nov 25");
    expect(dayHeading("2026-11-26", "2026-11-25")).toBe("Tomorrow · Nov 26");
  });
});
