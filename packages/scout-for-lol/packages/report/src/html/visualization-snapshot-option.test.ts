import { describe, expect, test } from "bun:test";
import { VisualizationSnapshotSchema } from "@scout-for-lol/data";
import {
  tooltipText,
  visualizationSnapshotToOption,
} from "#src/html/visualization-snapshot-option.ts";

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

  test("adds one baseline overlay for every compared series", () => {
    const point = {
      key: "2026-08-08",
      label: "2026-08-08",
      start: "2026-08-08T00:00:00.000Z",
      end: "2026-08-08T23:59:59.999Z",
      value: 2,
      comparisonValue: 1,
      absoluteDelta: 1,
      percentageDelta: 1,
      evidence: { sampleSize: 2, confidenceInterval: null },
      comparisonEvidence: { sampleSize: 1, confidenceInterval: null },
    };
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-08T00:00:00.000Z",
      kind: "LINE_CHART",
      title: null,
      temporal: {
        window: { kind: "relative", days: 30 },
        bucket: "day",
        comparison: { kind: "previous_period" },
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
          points: [point],
        },
        {
          id: "wins",
          label: "Wins",
          metric: "wins",
          additive: true,
          points: [point],
        },
      ],
      annotations: [],
      trends: [],
    });

    const option = JSON.stringify(
      visualizationSnapshotToOption(snapshot, "static"),
    );
    expect(option).toContain('"name":"Games baseline"');
    expect(option).toContain('"name":"Wins baseline"');
  });

  test("escapes report labels in interactive HTML tooltips", () => {
    const snapshot = VisualizationSnapshotSchema.parse({
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
          id: "unsafe",
          label: '<img src=x onerror="alert(1)">',
          metric: "games",
          additive: true,
          points: [
            {
              key: "unsafe",
              label: "<script>alert(1)</script>",
              start: "2026-08-08T00:00:00.000Z",
              end: "2026-08-08T00:00:00.000Z",
              value: 1,
              evidence: { sampleSize: 1, confidenceInterval: null },
            },
          ],
        },
      ],
      annotations: [],
      trends: [],
    });

    const tooltip = tooltipText(snapshot, { dataIndex: 0 });
    expect(tooltip).not.toContain("<script>");
    expect(tooltip).not.toContain("<img");
    expect(tooltip).toContain("&lt;script&gt;");
    expect(tooltip).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  test("uses the archived temporal range for an empty calendar", () => {
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2027-08-08T00:00:00.000Z",
      kind: "CALENDAR_HEATMAP",
      title: null,
      temporal: {
        window: {
          kind: "calendar",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        },
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
      series: [],
      annotations: [],
      trends: [],
    });

    expect(
      JSON.stringify(visualizationSnapshotToOption(snapshot, "static")),
    ).toContain('"range":["2026-01-01","2026-12-31"]');
  });
});
