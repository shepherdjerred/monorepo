import { describe, expect, test } from "bun:test";
import { VisualizationSnapshotSchema } from "@scout-for-lol/data";
import { visualizationSnapshotToOption } from "#src/html/visualization-snapshot-option.ts";

describe("visualizationSnapshotToOption", () => {
  test("does not add a baseline series without a comparison", () => {
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-08T00:00:00.000Z",
      kind: "LINE_CHART",
      title: null,
      temporal: {
        window: { kind: "relative", days: 30 },
        bucket: "day",
        timezone: "UTC",
      },
      bucket: "day",
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
          points: [
            {
              key: "2026-08-08",
              label: "2026-08-08",
              start: "2026-08-08T00:00:00.000Z",
              end: "2026-08-08T23:59:59.999Z",
              value: 2,
              comparisonValue: null,
              absoluteDelta: null,
              percentageDelta: null,
              evidence: { sampleSize: 2, confidenceInterval: null },
            },
          ],
        },
      ],
      annotations: [],
      trends: [],
    });

    expect(
      JSON.stringify(visualizationSnapshotToOption(snapshot, "static")),
    ).not.toContain("baseline");
  });
});
