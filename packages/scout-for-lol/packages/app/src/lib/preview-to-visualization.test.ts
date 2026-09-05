import { describe, expect, test } from "vitest";
import {
  type ReportAiPreviewSummary,
  UNGROUPED_LABEL_COLUMN_LABEL,
} from "@scout-for-lol/data";
import {
  isChartablePreview,
  plottableMetricColumns,
  previewToVisualizationSnapshot,
} from "./preview-to-visualization.ts";

describe("preview-to-visualization", () => {
  const samplePreview: ReportAiPreviewSummary = {
    columns: [
      { key: "label", label: "Champion", format: "text" },
      { key: "win_rate", label: "Win rate", format: "percent" },
      { key: "games", label: "Games", format: "integer" },
    ],
    rows: [
      {
        label: "Ahri",
        games: 25,
        values: [
          { column: "win_rate", value: 0.54 },
          { column: "games", value: 25 },
        ],
      },
      {
        label: "Jinx",
        games: 40,
        values: [
          { column: "win_rate", value: 0.51 },
          { column: "games", value: 40 },
        ],
      },
    ],
    visualizationRows: [],
    rowsReturned: 2,
    rowsScanned: 100,
    renderKind: "TABLE",
  };

  test("plottableMetricColumns filters out label and text columns", () => {
    const metrics = plottableMetricColumns(samplePreview.columns);
    expect(metrics.map((m) => m.key)).toEqual(["win_rate", "games"]);
  });

  test("isChartablePreview correctly identifies multi-row categorical data", () => {
    expect(isChartablePreview(samplePreview)).toBe(true);
    expect(isChartablePreview(null)).toBe(false);
    expect(isChartablePreview({ ...samplePreview, rows: [] })).toBe(false);
  });

  test("isChartablePreview returns false for ungrouped single-row scalar results", () => {
    const ungrouped: ReportAiPreviewSummary = {
      columns: [
        { key: "label", label: UNGROUPED_LABEL_COLUMN_LABEL, format: "text" },
        { key: "total_games", label: "Games", format: "integer" },
      ],
      rows: [
        {
          label: "All",
          values: [{ column: "total_games", value: 150 }],
        },
      ],
      visualizationRows: [],
      rowsReturned: 1,
      rowsScanned: 150,
      renderKind: "TABLE",
    };
    expect(isChartablePreview(ungrouped)).toBe(false);
  });

  test("previewToVisualizationSnapshot creates a valid BAR_CHART snapshot", () => {
    const snapshot = previewToVisualizationSnapshot(samplePreview);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.kind).toBe("BAR_CHART");
    expect(snapshot?.series).toHaveLength(1);
    expect(snapshot?.series[0]?.id).toBe("win_rate");
    expect(snapshot?.series[0]?.points).toHaveLength(2);
    expect(snapshot?.series[0]?.points[0]?.label).toBe("Ahri");
    expect(snapshot?.series[0]?.points[0]?.value).toBe(0.54);
    expect(snapshot?.series[0]?.displayKind).toBe("percent");
  });

  test("previewToVisualizationSnapshot allows selecting a different metric and chart kind", () => {
    const snapshot = previewToVisualizationSnapshot(samplePreview, {
      preferredKind: "DONUT_CHART",
      metricKey: "games",
      orientation: "horizontal",
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.kind).toBe("DONUT_CHART");
    expect(snapshot?.series[0]?.id).toBe("games");
    expect(snapshot?.series[0]?.displayKind).toBe("count");
    expect(snapshot?.series[0]?.points[1]?.label).toBe("Jinx");
    expect(snapshot?.series[0]?.points[1]?.value).toBe(40);
    expect(snapshot?.display.options?.orientation).toBe("horizontal");
  });
});
