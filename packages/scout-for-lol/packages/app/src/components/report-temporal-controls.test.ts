import { describe, expect, test } from "bun:test";
import { TemporalAnalysisSpecSchema } from "@scout-for-lol/data";
import {
  withCalendarComparisonBoundary,
  withCalendarWindowBoundary,
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
});
