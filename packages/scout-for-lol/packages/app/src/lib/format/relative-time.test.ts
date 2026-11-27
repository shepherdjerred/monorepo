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

  test("a game over a week old reads as its date, not a count", () => {
    // The design-audit seed pins its older games to 2025-12-31.
    const seeded = Date.UTC(2025, 11, 31, 16, 0, 0);
    expect(relativeWhenInline(seeded, NOW)).toBe("Dec 31");
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
