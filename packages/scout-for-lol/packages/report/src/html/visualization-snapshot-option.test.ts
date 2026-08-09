import { describe, expect, test } from "bun:test";
import { VisualizationSnapshotSchema } from "@scout-for-lol/data";
import { calendarTooltipText } from "#src/html/visualization-calendar-tooltip.ts";
import {
  tooltipText,
  visualizationSnapshotToOption,
} from "#src/html/visualization-snapshot-option.ts";
import { usesPercentageAxis } from "#src/html/visualization-value-format.ts";

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
});

describe("temporal chart rendering", () => {
  test("aligns sparse trend values to global patch categories", () => {
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-08T00:00:00.000Z",
      kind: "LINE_CHART",
      title: null,
      temporal: {
        window: { kind: "relative", days: 90 },
        bucket: "patch",
        timezone: "UTC",
      },
      bucket: "patch",
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
        patchSeries("alpha", ["26.1", "26.2", "26.3"]),
        patchSeries("beta", ["26.2", "26.3", "26.4"]),
      ],
      annotations: [],
      trends: [
        {
          seriesId: "beta",
          slope: 1,
          rSquared: 1,
          values: [2, 3, 4],
        },
      ],
    });

    expect(
      JSON.stringify(visualizationSnapshotToOption(snapshot, "static")),
    ).toContain('"data":[null,2,3,4]');
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

  test("formats rate values and absolute deltas as percentages", () => {
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
          id: "win-rate",
          label: "Win rate",
          metric: "win_rate",
          additive: false,
          points: [
            {
              key: "2026-08-08",
              label: "2026-08-08",
              start: "2026-08-08T00:00:00.000Z",
              end: "2026-08-08T23:59:59.999Z",
              value: 0.5,
              comparisonValue: 0.4,
              absoluteDelta: 0.1,
              percentageDelta: 0.25,
              evidence: { sampleSize: 10, confidenceInterval: null },
            },
          ],
        },
      ],
      annotations: [],
      trends: [],
    });

    const tooltip = tooltipText(snapshot, { dataIndex: 0 });
    expect(tooltip).toContain("Win rate: 50.0%");
    expect(tooltip).toContain("Baseline: 40.0%");
    expect(tooltip).toContain("Δ 10.0 pp");
    expect(usesPercentageAxis(snapshot)).toBe(true);
  });
});

function patchSeries(id: string, labels: string[]) {
  return {
    id,
    label: id,
    metric: "games",
    additive: true,
    points: labels.map((label, index) => ({
      key: label,
      label,
      start: `2026-0${(index + 1).toString()}-01T00:00:00.000Z`,
      end: `2026-0${(index + 1).toString()}-01T00:00:00.000Z`,
      value: index + 1,
      evidence: { sampleSize: 1, confidenceInterval: null },
    })),
  };
}

describe("calendar visualization options", () => {
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

  test("shows calendar baselines and deltas in comparison tooltips", () => {
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-08T00:00:00.000Z",
      kind: "CALENDAR_HEATMAP",
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
      series: [],
      annotations: [],
      trends: [],
    });

    const tooltip = calendarTooltipText(snapshot, {
      data: ["2026-08-08", 0.6, 0.4, 0.2, 0.5, 10],
    });
    expect(tooltip).toContain("0.6 (n=10)");
    expect(tooltip).toContain("Baseline: 0.4");
    expect(tooltip).toContain("Δ 0.2");
    expect(tooltip).toContain("50.0%");
  });
});
