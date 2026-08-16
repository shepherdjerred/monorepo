import { describe, expect, test } from "bun:test";
import { isInHistoricalUtcWeek } from "./recap-history.ts";

describe("isInHistoricalUtcWeek", () => {
  const now = new Date("2026-08-12T12:00:00.000Z");

  test("matches the same Monday-Sunday week from an older year", () => {
    expect(
      isInHistoricalUtcWeek(new Date("2025-08-09T12:00:00.000Z"), now),
    ).toBe(false);
    expect(
      isInHistoricalUtcWeek(new Date("2025-08-11T12:00:00.000Z"), now),
    ).toBe(true);
    expect(
      isInHistoricalUtcWeek(new Date("2025-08-16T12:00:00.000Z"), now),
    ).toBe(true);
    expect(
      isInHistoricalUtcWeek(new Date("2025-08-17T12:00:00.000Z"), now),
    ).toBe(false);
  });

  test("handles a week that crosses New Year's Day", () => {
    const newYearNow = new Date("2028-01-02T12:00:00.000Z");
    expect(
      isInHistoricalUtcWeek(new Date("2025-12-30T12:00:00.000Z"), newYearNow),
    ).toBe(true);
    expect(
      isInHistoricalUtcWeek(new Date("2025-01-01T12:00:00.000Z"), newYearNow),
    ).toBe(true);
    expect(
      isInHistoricalUtcWeek(new Date("2025-12-26T12:00:00.000Z"), newYearNow),
    ).toBe(false);
  });
});
