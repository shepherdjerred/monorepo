import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ExploreMessageSchema,
  VisualizationSnapshotSchema,
  type ExploreMessage,
} from "@scout-for-lol/data";
import {
  ExploreVisualResult,
  initialChartKind,
  initialMetricKey,
} from "#src/components/explore-visual-result.tsx";

function createMessage(overrides: Record<string, unknown>): ExploreMessage {
  return ExploreMessageSchema.parse({
    id: "44444444-4444-4444-8444-444444444444",
    role: "assistant",
    parentId: "33333333-3333-4333-8333-333333333333",
    content: "Here is your data.",
    createdAt: "2026-08-14T12:00:30.000Z",
    ...overrides,
  });
}

describe("ExploreVisualResult", () => {
  const chartablePreview = {
    columns: [
      { key: "label", label: "Champion", format: "text" as const },
      { key: "win_rate", label: "Win rate", format: "percent" as const },
      { key: "games", label: "Games", format: "integer" as const },
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
    renderKind: "TABLE" as const,
  };

  const persistedLineChart = VisualizationSnapshotSchema.parse({
    version: 1,
    generatedAt: "2026-08-14T12:00:30.000Z",
    kind: "LINE_CHART",
    title: "Win rate by patch",
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
        id: "win_rate",
        label: "Win rate",
        metric: "win_rate",
        displayKind: "percent",
        additive: false,
        points: [
          {
            key: "26.15",
            label: "26.15",
            start: "2026-08-01T00:00:00.000Z",
            end: "2026-08-14T00:00:00.000Z",
            value: 0.54,
            evidence: { sampleSize: 25 },
          },
        ],
      },
    ],
    annotations: [],
    trends: [],
  });

  test("uses the persisted chart kind before preview defaults", () => {
    expect(initialChartKind(persistedLineChart, chartablePreview)).toBe(
      "LINE_CHART",
    );
  });

  test("uses the preview render kind when no snapshot is persisted", () => {
    expect(
      initialChartKind(null, {
        ...chartablePreview,
        renderKind: "DONUT_CHART",
      }),
    ).toBe("DONUT_CHART");
  });

  test("uses the persisted metric when it is present in the preview", () => {
    expect(initialMetricKey(persistedLineChart, chartablePreview.columns)).toBe(
      "win_rate",
    );
  });

  test("renders both Chart and Table tab controls for chartable results", () => {
    const message = createMessage({ preview: chartablePreview });
    const markup = renderToStaticMarkup(
      <ExploreVisualResult message={message} />,
    );

    expect(markup).toContain("Chart");
    expect(markup).toContain("Table");
  });

  test("renders SingleRowResult for ungrouped single-row results without tabs", () => {
    const ungrouped = {
      columns: [
        { key: "label", label: "Label", format: "text" as const },
        { key: "games", label: "Games", format: "integer" as const },
      ],
      rows: [
        {
          label: "All",
          values: [{ column: "games", value: 50 }],
        },
      ],
      visualizationRows: [],
      rowsReturned: 1,
      rowsScanned: 50,
      renderKind: "TABLE" as const,
    };
    const message = createMessage({ preview: ungrouped });
    const markup = renderToStaticMarkup(
      <ExploreVisualResult message={message} />,
    );

    expect(markup).not.toContain("Chart");
    expect(markup).not.toContain("Table");
    expect(markup).toContain("Games");
    expect(markup).toContain("50");
  });

  test("returns null when no preview or visualization rows exist", () => {
    const emptyPreview = {
      ...chartablePreview,
      rows: [],
      rowsReturned: 0,
    };
    const message = createMessage({ preview: emptyPreview });
    const markup = renderToStaticMarkup(
      <ExploreVisualResult message={message} />,
    );

    expect(markup).toBe("");
  });
});
