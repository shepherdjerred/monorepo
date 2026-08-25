import { describe, expect, test } from "vitest";
import { VisualizationSnapshotSchema } from "@scout-for-lol/data";
import { calendarTooltipText } from "#src/html/visualization-calendar-tooltip.ts";
import {
  tooltipText,
  visualizationSnapshotToOption,
} from "#src/html/visualization-snapshot-option.ts";
import {
  formatSnapshotAxisValue,
  usesPercentageAxis,
} from "#src/html/visualization-value-format.ts";

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
        patchSeries("beta", ["26.2", "26.4"]),
        patchSeries("alpha", ["26.1", "26.3"]),
      ],
      annotations: [],
      trends: [
        {
          seriesId: "beta",
          slope: 1,
          rSquared: 1,
          values: [2, 4],
        },
      ],
    });

    const option = JSON.stringify(
      visualizationSnapshotToOption(snapshot, "static"),
    );
    expect(option).toContain('"data":["26.1","26.2","26.3","26.4"]');
    expect(option).toContain('"data":[null,2,null,4]');
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
              evidence: {
                games: 10,
                sampleSize: 10,
                confidenceInterval: { level: 0.95, lower: 0.4, upper: 0.6 },
              },
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
    expect(tooltip).toContain("Based on 10 games");
    expect(tooltip).not.toContain("95% CI");
    expect(usesPercentageAxis(snapshot)).toBe(true);
    expect(formatSnapshotAxisValue(snapshot, 0.5)).toBe("50.0%");
  });

  test("places annotations only in the bucket containing their timestamp", () => {
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-08T00:00:00.000Z",
      kind: "LINE_CHART",
      title: null,
      temporal: {
        window: { kind: "relative", days: 2 },
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
          points: [dayPoint("2026-08-01", 1), dayPoint("2026-08-02", 2)],
        },
      ],
      annotations: [
        {
          id: "inside",
          kind: "competition_start",
          timestamp: "2026-08-01T12:00:00.000Z",
          label: "Inside first day",
        },
        {
          id: "future",
          kind: "competition_end",
          timestamp: "2026-08-03T12:00:00.000Z",
          label: "Outside range",
        },
      ],
      trends: [],
    });

    const option = JSON.stringify(
      visualizationSnapshotToOption(snapshot, "static"),
    );
    expect(option).toContain('"xAxis":"2026-08-01","name":"Inside first day"');
    expect(option).not.toContain("Outside range");
  });
});

describe("archived chart presentation", () => {
  test("replays preserved theme, labels, legend, orientation, axes, and sort", () => {
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-08T00:00:00.000Z",
      kind: "BAR_CHART",
      title: "Configured title",
      temporal: null,
      bucket: null,
      display: {
        theme: "minimal_light",
        palette: "team",
        smooth: false,
        stack: "none",
        rollingWindow: null,
        cumulative: false,
        sparkline: false,
        options: {
          subtitle: "Configured subtitle",
          xAxisLabel: "Games played",
          yAxisLabel: "Champion",
          theme: "minimal_light",
          palette: "team",
          orientation: "horizontal",
          labels: "value",
          legend: "none",
          sort: "asc",
        },
      },
      series: [
        {
          id: "games",
          label: "Games",
          metric: "games",
          additive: true,
          points: [dayPoint("Alpha", 3), dayPoint("Beta", 1)],
        },
      ],
      annotations: [],
      trends: [],
    });

    const option = JSON.stringify(
      visualizationSnapshotToOption(snapshot, "static"),
    );
    expect(option).toContain('"backgroundColor":"#f8fafc"');
    expect(option).toContain('"subtext":"Configured subtitle"');
    expect(option).toContain('"legend":{"show":false');
    expect(option).toContain('"xAxis":{"type":"value","name":"Games played"');
    expect(option).toContain(
      '"yAxis":{"type":"category","data":["Beta","Alpha"],"name":"Champion"',
    );
    expect(option).toContain('"label":{"show":true,"position":"right"}');
  });
});

describe("scatter chart rendering", () => {
  test("omits points whose configured x output is null or missing", () => {
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-08T00:00:00.000Z",
      kind: "SCATTER_CHART",
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
          id: "damage",
          label: "Damage",
          metric: "damage_per_game",
          additive: false,
          points: [
            scatterPoint("missing-x", 7),
            scatterPoint("null-x", 8, null),
            scatterPoint("valid-x", 9, 42),
          ],
        },
      ],
      annotations: [],
      trends: [],
    });

    const option = JSON.stringify(
      visualizationSnapshotToOption(snapshot, "static"),
    );
    expect(option).not.toContain('"name":"missing-x"');
    expect(option).not.toContain('"name":"null-x"');
    expect(option).toContain('"id":"valid-x","name":"valid-x","value":[42,9]');
  });

  test("resolves tooltips through the hovered series data order", () => {
    const snapshot = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-08T00:00:00.000Z",
      kind: "SCATTER_CHART",
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
          id: "alpha",
          label: "Alpha",
          metric: "games",
          additive: true,
          points: [scatterPoint("alpha-point", 10, 1)],
        },
        {
          id: "beta",
          label: "Beta",
          metric: "games",
          additive: true,
          points: [
            scatterPoint("beta-hidden", 20, null),
            scatterPoint("beta-visible", 30, 3),
          ],
        },
      ],
      annotations: [],
      trends: [],
    });

    const tooltip = tooltipText(snapshot, {
      seriesId: "beta",
      seriesName: "Beta",
      dataIndex: 99,
      data: { id: "beta-visible" },
    });
    expect(tooltip).toContain("beta-visible");
    expect(tooltip).toContain("Beta: 30");
    expect(tooltip).not.toContain("alpha-point");
    expect(tooltip).not.toContain("Alpha:");
  });
});

test("adds a thin-data subtitle to rate charts", () => {
  const thinOption = JSON.stringify(
    visualizationSnapshotToOption(rateSnapshot(9), "static"),
  );
  const sufficientOption = JSON.stringify(
    visualizationSnapshotToOption(rateSnapshot(10), "static"),
  );
  const caveat = "Fewer than 10 games — treat this rate as indicative only.";
  expect(thinOption).toContain(caveat);
  expect(sufficientOption).not.toContain(caveat);
});

function rateSnapshot(games: number) {
  return VisualizationSnapshotSchema.parse({
    version: 1,
    generatedAt: "2026-08-08T00:00:00.000Z",
    kind: "LINE_CHART",
    title: "Win rate",
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
        id: "win-rate",
        label: "Win rate",
        metric: "win_rate",
        additive: false,
        points: [
          {
            key: "win-rate",
            label: "Win rate",
            start: "2026-08-08T00:00:00.000Z",
            end: "2026-08-08T23:59:59.999Z",
            value: 0.5,
            evidence: { games, sampleSize: games },
          },
        ],
      },
    ],
    annotations: [],
    trends: [],
  });
}

function scatterPoint(label: string, value: number, xValue?: number | null) {
  return {
    key: label,
    label,
    start: "2026-08-08T00:00:00.000Z",
    end: "2026-08-08T00:00:00.000Z",
    value,
    ...(xValue === undefined ? {} : { xValue }),
    evidence: { sampleSize: 1, confidenceInterval: null },
  };
}

function dayPoint(label: string, value: number) {
  const temporal = /^\d{4}-\d{2}-\d{2}$/u.test(label);
  return {
    key: label,
    label,
    start: temporal ? `${label}T00:00:00.000Z` : "2026-08-08T00:00:00.000Z",
    end: temporal ? `${label}T23:59:59.999Z` : "2026-08-08T00:00:00.000Z",
    value,
    evidence: { sampleSize: value, confidenceInterval: null },
  };
}

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
    expect(tooltip).toContain("0.6 (Based on 10 games)");
    expect(tooltip).toContain("Baseline: 0.4");
    expect(tooltip).toContain("Δ 0.2");
    expect(tooltip).toContain("50.0%");
  });
});
