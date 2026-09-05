import { describe, expect, test } from "vitest";
import { VisualizationSnapshotSchema } from "@scout-for-lol/data";
import { visualizationPointClickDetails } from "#src/components/interactive-visualization.tsx";

describe("visualizationPointClickDetails", () => {
  test("decodes heatmap tuple clicks using both axes", () => {
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-14T12:00:30.000Z",
      kind: "HEATMAP",
      title: "Champion positions",
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
        options: null,
      },
      series: [
        {
          id: "top",
          label: "Top",
          metric: "win_rate",
          displayKind: "percent",
          additive: false,
          points: [
            {
              key: "ahri",
              label: "Ahri",
              start: "2026-08-01T00:00:00.000Z",
              end: "2026-08-14T00:00:00.000Z",
              value: 0.62,
              evidence: { sampleSize: 25 },
            },
          ],
        },
      ],
      annotations: [],
      trends: [],
    });

    expect(
      visualizationPointClickDetails(snapshot, {
        data: [0, 0, 0.62],
        name: "",
        seriesName: "",
        value: [0, 0, 0.62],
      }),
    ).toEqual({
      label: "Top: Ahri",
      value: 0.62,
      seriesName: "Top",
    });
  });

  test("decodes calendar tuple clicks from the persisted point", () => {
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-14T12:00:30.000Z",
      kind: "CALENDAR_HEATMAP",
      title: "Games by day",
      temporal: null,
      bucket: "day",
      display: {
        theme: null,
        palette: null,
        smooth: false,
        stack: "none",
        rollingWindow: null,
        cumulative: false,
        sparkline: false,
        options: null,
      },
      series: [
        {
          id: "games",
          label: "Games",
          metric: "games",
          displayKind: "count",
          additive: true,
          points: [
            {
              key: "2026-08-14",
              label: "2026-08-14",
              start: "2026-08-14T00:00:00.000Z",
              end: "2026-08-15T00:00:00.000Z",
              value: 12,
              evidence: { sampleSize: 12 },
            },
          ],
        },
      ],
      annotations: [],
      trends: [],
    });

    expect(
      visualizationPointClickDetails(snapshot, {
        data: ["2026-08-14", 12, null, null, null, 12],
        name: "",
        seriesName: "",
        value: ["2026-08-14", 12, null, null, null, 12],
      }),
    ).toEqual({
      label: "2026-08-14",
      value: 12,
      seriesName: "Games",
    });
  });
});
