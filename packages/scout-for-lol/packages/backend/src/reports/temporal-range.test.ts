import { describe, expect, test } from "bun:test";
import { TemporalAnalysisSpecSchema } from "@scout-for-lol/data";
import {
  clampTemporalRange,
  resolveTemporalRanges,
} from "#src/reports/temporal-range.ts";

describe("temporal range resolution", () => {
  test("uses inclusive local dates across a daylight-saving boundary", () => {
    const ranges = resolveTemporalRanges(
      TemporalAnalysisSpecSchema.parse({
        window: {
          kind: "calendar",
          startDate: "2026-03-08",
          endDate: "2026-03-08",
        },
        bucket: "day",
        timezone: "America/Los_Angeles",
      }),
      new Date("2026-04-01T00:00:00.000Z"),
    );
    expect(ranges.current.startDate.toISOString()).toBe(
      "2026-03-08T08:00:00.000Z",
    );
    expect(ranges.current.endDate.toISOString()).toBe(
      "2026-03-09T06:59:59.999Z",
    );
  });

  test("ends relative windows at execution time and aligns previous periods", () => {
    const now = new Date("2026-08-08T12:34:56.000Z");
    const ranges = resolveTemporalRanges(
      TemporalAnalysisSpecSchema.parse({
        window: { kind: "relative", days: 30 },
        bucket: "auto",
        comparison: { kind: "previous_period" },
        timezone: "UTC",
      }),
      now,
    );
    expect(ranges.current.endDate).toEqual(now);
    expect(
      ranges.current.endDate.getTime() - ranges.current.startDate.getTime(),
    ).toBe(30 * 86_400_000);
    expect(ranges.comparison?.endDate).toEqual(ranges.current.startDate);
  });

  test("clamps selected periods to competition dates", () => {
    expect(
      clampTemporalRange(
        {
          startDate: new Date("2025-01-01T00:00:00.000Z"),
          endDate: new Date("2027-01-01T00:00:00.000Z"),
        },
        {
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          endDate: new Date("2026-12-01T00:00:00.000Z"),
        },
        new Date("2026-08-08T00:00:00.000Z"),
      ),
    ).toEqual({
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-08-08T00:00:00.000Z"),
    });
  });
});
