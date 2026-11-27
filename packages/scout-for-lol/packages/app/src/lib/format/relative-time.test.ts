import { describe, expect, test } from "vitest";
import {
  relativeWhen,
  relativeWhenInline,
} from "#src/lib/format/relative-time.ts";

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeWhen", () => {
  test.each([
    [10_000, "Just now"],
    [MINUTE, "1 minute ago"],
    [45 * MINUTE, "45 minutes ago"],
    [HOUR, "1 hour ago"],
    [2 * HOUR + 40 * MINUTE, "2 hours ago"],
    [23 * HOUR, "23 hours ago"],
    [DAY, "Yesterday"],
    [47 * HOUR, "Yesterday"],
    [2 * DAY, "2 days ago"],
    [6 * DAY + HOUR, "6 days ago"],
    [10 * DAY, "Nov 17"],
  ])("%i ms ago reads %s", (elapsed, text) => {
    expect(relativeWhen(NOW - elapsed, NOW)).toBe(text);
  });

  test("a missing time fails loudly rather than reading as 1970", () => {
    expect(() => relativeWhen(0, NOW)).toThrow("not a time");
    expect(() => relativeWhen(Number.NaN, NOW)).toThrow("not a time");
    expect(() => relativeWhenInline(-1, NOW)).toThrow("not a time");
  });

  test("a date in another year says the year, so December does not read as last month", () => {
    // The design-audit seed pins its older games to 2025-12-31.
    const seeded = Date.UTC(2025, 11, 31, 16, 0, 0);
    expect(relativeWhen(seeded, NOW)).toBe("Dec 31, 2025");
    expect(relativeWhenInline(seeded, NOW)).toBe("Dec 31, 2025");
  });

  test("a date in the current year leaves the year out, and the year line is by UTC", () => {
    expect(relativeWhen(Date.UTC(2026, 0, 2, 12), NOW)).toBe("Jan 2");
    // Seven days before New Year's Day, read on New Year's Day: last year.
    const newYear = Date.UTC(2027, 0, 1, 1, 0, 0);
    expect(relativeWhen(Date.UTC(2026, 11, 20, 12), newYear)).toBe(
      "Dec 20, 2026",
    );
  });

  test("a time slightly in the future reads as now", () => {
    expect(relativeWhen(NOW + 5000, NOW)).toBe("Just now");
  });

  test("the inline form lower-cases only the words that start a sentence", () => {
    expect(relativeWhenInline(NOW - DAY, NOW)).toBe("yesterday");
    expect(relativeWhenInline(NOW - 5, NOW)).toBe("just now");
    expect(relativeWhenInline(NOW - 3 * HOUR, NOW)).toBe("3 hours ago");
    expect(relativeWhenInline(NOW - 10 * DAY, NOW)).toBe("Nov 17");
  });
});
