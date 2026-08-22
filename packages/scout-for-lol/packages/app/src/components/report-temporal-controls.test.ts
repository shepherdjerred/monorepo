import { describe, expect, test } from "vitest";
import { TemporalAnalysisSpecSchema } from "@scout-for-lol/data";
import {
  comparisonFor,
  withCalendarComparisonBoundary,
  withCalendarWindowBoundary,
  withRange,
} from "#src/components/report-temporal-controls.tsx";

const analysis = TemporalAnalysisSpecSchema.parse({
  window: {
    kind: "calendar",
    startDate: "2026-08-01",
    endDate: "2026-08-10",
  },
  bucket: "day",
  comparison: {
    kind: "calendar",
    startDate: "2026-07-01",
    endDate: "2026-07-10",
  },
  timezone: "UTC",
});

describe("report temporal date controls", () => {
  test("moves the opposite baseline endpoint to preserve equal length", () => {
    expect(
      withCalendarComparisonBoundary(analysis, "startDate", "2026-06-01")
        .comparison,
    ).toEqual({
      kind: "calendar",
      startDate: "2026-06-01",
      endDate: "2026-06-10",
    });
    expect(
      withCalendarComparisonBoundary(analysis, "endDate", "2026-06-30")
        .comparison,
    ).toEqual({
      kind: "calendar",
      startDate: "2026-06-21",
      endDate: "2026-06-30",
    });
  });

  test("resizes a custom baseline atomically when the main period changes", () => {
    const updated = withCalendarWindowBoundary(
      analysis,
      "endDate",
      "2026-08-15",
    );
    expect(updated.window).toEqual({
      kind: "calendar",
      startDate: "2026-08-01",
      endDate: "2026-08-15",
    });
    expect(updated.comparison).toEqual({
      kind: "calendar",
      startDate: "2026-07-01",
      endDate: "2026-07-15",
    });
    expect(() => TemporalAnalysisSpecSchema.parse(updated)).not.toThrow();
  });

  test("creates calendar defaults in the selected analysis timezone", () => {
    const relative = TemporalAnalysisSpecSchema.parse({
      window: { kind: "relative", days: 30 },
      bucket: "day",
      timezone: "America/Los_Angeles",
    });
    const now = new Date("2026-01-01T01:30:00.000Z");

    expect(withRange(relative, "custom", now).window).toEqual({
      kind: "calendar",
      startDate: "2025-12-02",
      endDate: "2025-12-31",
    });
    expect(comparisonFor(relative, "calendar", now)).toEqual({
      kind: "calendar",
      startDate: "2025-11-02",
      endDate: "2025-12-01",
    });
  });
});
