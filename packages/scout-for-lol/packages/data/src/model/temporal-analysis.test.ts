import { describe, expect, test } from "vitest";
import {
  resolveTemporalBucket,
  TemporalAnalysisSpecSchema,
  VisualizationSnapshotSchema,
} from "#src/model/temporal-analysis.ts";

describe("temporal analysis contracts", () => {
  test("requires equal custom comparison lengths", () => {
    expect(() =>
      TemporalAnalysisSpecSchema.parse({
        window: {
          kind: "calendar",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        },
        bucket: "day",
        comparison: {
          kind: "calendar",
          startDate: "2025-12-01",
          endDate: "2025-12-30",
        },
        timezone: "UTC",
      }),
    ).toThrow("same length");
  });

  test("rejects a calendar window that ends before it starts", () => {
    expect(() =>
      TemporalAnalysisSpecSchema.parse({
        window: {
          kind: "calendar",
          startDate: "2026-01-31",
          endDate: "2026-01-01",
        },
        bucket: "day",
        timezone: "UTC",
      }),
    ).toThrow("on or after the start date");
  });

  test("uses documented automatic bucket thresholds", () => {
    expect(resolveTemporalBucket("auto", 60)).toBe("day");
    expect(resolveTemporalBucket("auto", 61)).toBe("week");
    expect(resolveTemporalBucket("auto", 365)).toBe("week");
    expect(resolveTemporalBucket("auto", 366)).toBe("month");
  });

  test("enforces the total visualization point ceiling", () => {
    const point = {
      key: "2026-01-01",
      label: "2026-01-01",
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-01T23:59:59.999Z",
      value: 1,
      evidence: { sampleSize: 1, confidenceInterval: null },
    };
    expect(() =>
      VisualizationSnapshotSchema.parse({
        version: 1,
        generatedAt: "2026-08-08T00:00:00.000Z",
        kind: "LINE_CHART",
        title: null,
        temporal: null,
        bucket: null,
        display: {
          theme: null,
          palette: null,
          smooth: false,
          stack: "none",
          rollingWindow: null,
          cumulative: false,
          sparkline: false,
        },
        series: [
          {
            id: "games",
            label: "Games",
            metric: "games",
            additive: true,
            points: Array.from({ length: 2001 }, () => point),
          },
        ],
        annotations: [],
        trends: [],
      }),
    ).toThrow("at most 2000 points");
  });
});
