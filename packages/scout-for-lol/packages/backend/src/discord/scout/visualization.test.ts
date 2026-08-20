import { describe, expect, test } from "bun:test";
import {
  ExploreMessageSchema,
  ReportAiPreviewSummarySchema,
  VisualizationSnapshotSchema,
} from "@scout-for-lol/data";
import {
  scoutTestBarChart,
  scoutTestKpi,
  scoutTestLeaderboard,
  scoutTestVisualization,
} from "#src/discord/scout/test-fixtures.ts";
import {
  exploreVisualizationPayload,
  usesNativeDiscordVisualization,
  visualizationToEmbed,
} from "#src/discord/scout/visualization.ts";
import {
  displayWidth,
  formatPreviewValueWithEvidence,
} from "#src/discord/scout/visualization-format.ts";

const answer = ExploreMessageSchema.parse({
  id: "10000000-0000-4000-8000-000000000002",
  role: "assistant",
  parentId: "10000000-0000-4000-8000-000000000001",
  siblingIds: ["10000000-0000-4000-8000-000000000002"],
  content: "Aurora leads.",
  caveats: [],
  createdAt: "2026-08-18T00:00:00.000Z",
});

const preview = ReportAiPreviewSummarySchema.parse({
  columns: [
    { key: "label", label: "Champion / queue", format: "text" },
    { key: "games", label: "Games", format: "integer" },
    { key: "win_rate", label: "Win rate", format: "percent" },
  ],
  rows: [
    {
      label: "Aurora • solo",
      values: [
        { column: "games", value: 8 },
        { column: "win_rate", value: 1 },
      ],
    },
    {
      label: "Jhin • flex",
      values: [
        { column: "games", value: 7 },
        { column: "win_rate", value: 0.286 },
      ],
    },
  ],
  rowsScanned: 2,
  renderKind: "LEADERBOARD",
});

describe("Scout Discord visualizations", () => {
  test("renders tables, leaderboards, and KPI cards as embeds", () => {
    expect(usesNativeDiscordVisualization(scoutTestVisualization)).toBe(true);
    const table = exploreVisualizationPayload({
      ...answer,
      preview,
      visualization: scoutTestVisualization,
    });
    const tableJson = JSON.stringify(table.embeds);
    expect(table.files).toBeUndefined();
    expect(tableJson).toContain("Win rates");
    expect(tableJson).toContain("Games");
    expect(tableJson).not.toContain("| Games |");
    expect(tableJson).toContain("Aurora • solo");
    expect(tableJson).toContain("100.0%");

    const board = exploreVisualizationPayload({
      ...answer,
      preview,
      visualization: scoutTestLeaderboard,
    });
    expect(JSON.stringify(board.embeds)).toContain("**1.** Aurora • solo");

    const list = exploreVisualizationPayload({
      ...answer,
      visualization: VisualizationSnapshotSchema.parse({
        ...scoutTestVisualization,
        kind: "LIST",
      }),
    });
    const listJson = JSON.stringify(list.embeds);
    expect(listJson).toContain("- Aurora: Games: 8, Win rate: 100.0%");
    expect(listJson).not.toContain("| Games |");

    const leaderboardJson = JSON.stringify(board.embeds);
    expect(leaderboardJson).toContain("Games: 8 · Win rate: 100.0%");

    const kpi = exploreVisualizationPayload({
      ...answer,
      visualization: scoutTestKpi,
    });
    const kpiDescription = kpi.embeds?.[0]?.data.description;
    expect(kpiDescription).toContain("56");
    expect(kpiDescription).toContain("Games counted");
    expect(kpiDescription).not.toContain("42");

    const subtitleKpi = VisualizationSnapshotSchema.parse({
      ...scoutTestKpi,
      display: {
        ...scoutTestKpi.display,
        options: { subtitle: "By player" },
      },
    });
    expect(visualizationToEmbed(subtitleKpi)?.data.description).toContain(
      "By player",
    );
    const longSubtitleKpi = VisualizationSnapshotSchema.parse({
      ...subtitleKpi,
      display: {
        ...subtitleKpi.display,
        options: { subtitle: "By player ".repeat(500) },
      },
    });
    const longSubtitleDescription =
      visualizationToEmbed(longSubtitleKpi)?.data.description;
    expect(longSubtitleDescription).toContain("Games counted");
    expect(longSubtitleDescription).toContain("56");

    const comparisonKpi = VisualizationSnapshotSchema.parse({
      ...scoutTestKpi,
      series: [
        {
          ...scoutTestKpi.series[0],
          points: [
            {
              ...scoutTestKpi.series[0]?.points[1],
              comparisonValue: 42,
              absoluteDelta: 14,
              percentageDelta: 1 / 3,
              comparisonEvidence: {
                sampleSize: 42,
                confidenceInterval: null,
              },
            },
          ],
        },
      ],
    });
    const comparisonDescription =
      visualizationToEmbed(comparisonKpi)?.data.description;
    expect(comparisonDescription).toContain("n=56");
    expect(comparisonDescription).toContain("Baseline: 42");
    expect(comparisonDescription).toContain("Δ 14");
    expect(comparisonDescription).toContain("33.3%");
    expect(kpiDescription).not.toContain("Baseline:");
  });

  test("renders an explicit empty state for empty native results", () => {
    const empty = VisualizationSnapshotSchema.parse({
      ...scoutTestVisualization,
      series: [],
    });
    const payload = exploreVisualizationPayload({
      ...answer,
      visualization: empty,
    });
    expect(payload.embeds?.[0]?.data.description).toBe("No results found.");
  });
});

describe("Scout Discord visualization edge cases", () => {
  test("renders an explicit empty state for generated empty series", () => {
    const emptySeriesSnapshot = VisualizationSnapshotSchema.parse({
      ...scoutTestVisualization,
      kind: "LIST",
      series: scoutTestVisualization.series.map((series) => ({
        ...series,
        points: [],
      })),
    });

    expect(visualizationToEmbed(emptySeriesSnapshot)?.data.description).toBe(
      "No results found.",
    );

    const emptyKpiSnapshot = VisualizationSnapshotSchema.parse({
      ...scoutTestKpi,
      series: [],
    });
    expect(visualizationToEmbed(emptyKpiSnapshot)?.data.description).toBe(
      "No results found.",
    );
  });

  test("sanitizes table headers before rendering", () => {
    const headerSnapshot = VisualizationSnapshotSchema.parse({
      ...scoutTestVisualization,
      kind: "TABLE",
      series: scoutTestVisualization.series.map((series) => ({
        ...series,
        label: "Games ` and ```\r\n| unsafe",
      })),
    });

    const description = visualizationToEmbed(headerSnapshot)?.data.description;
    expect(description).toContain("Games ` and ′′′");
    expect(description).toContain("| unsafe");
    expect(description).not.toContain("Games `\n");
  });

  test("preserves overflow state for legacy previews", () => {
    const legacyPreview = ReportAiPreviewSummarySchema.parse({
      columns: preview.columns,
      rows: preview.rows.slice(0, 1),
      rowsScanned: preview.rowsScanned,
      renderKind: preview.renderKind,
    });
    const description = visualizationToEmbed(
      scoutTestVisualization,
      legacyPreview,
    )?.data.description;
    expect(description).toContain(
      "additional rows omitted from the stored preview",
    );

    const collapsedSnapshot = VisualizationSnapshotSchema.parse({
      ...scoutTestVisualization,
      series: scoutTestVisualization.series.map((series, index) => ({
        ...series,
        id: `Champion ${index.toString()}:${series.metric}`,
        label: `Champion ${index.toString()} — ${series.label}`,
        points: series.points.map((point) => ({
          ...point,
          key: "solo",
          label: "solo",
        })),
      })),
    });
    const collapsedDescription = visualizationToEmbed(
      collapsedSnapshot,
      preview,
    )?.data.description;
    expect(collapsedDescription).toContain(
      "additional rows may be omitted from the stored visualization",
    );
  });

  test("escapes Markdown in native labels and preview values", () => {
    const textPreview = ReportAiPreviewSummarySchema.parse({
      columns: [
        { key: "label", label: "Player", format: "text" },
        { key: "note", label: "Note", format: "text" },
      ],
      rows: [
        {
          label: "[name](https://example.com) ~~strike~~",
          values: [{ column: "note", value: "[unsafe]\n~~value~~" }],
        },
      ],
      rowsScanned: 1,
      renderKind: "LIST",
    });
    const description = visualizationToEmbed(
      VisualizationSnapshotSchema.parse({
        ...scoutTestVisualization,
        kind: "LIST",
      }),
      textPreview,
    )?.data.description;
    expect(description).not.toContain("[name](https://example.com)");
    expect(description).not.toContain("~~strike~~");
    expect(description).not.toContain("[unsafe]\n~~value~~");
  });
});

describe("Scout Discord visualization bounds", () => {
  test("renders the stored visualization rows and only claims real overflow", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      label: `Champion ${index.toString()}`,
      values: [
        { column: "games", value: index + 1 },
        { column: "win_rate", value: 0.5 },
      ],
    }));
    const extendedPreview = ReportAiPreviewSummarySchema.parse({
      ...preview,
      rows: rows.slice(0, 10),
      visualizationRows: rows,
      rowsReturned: 13,
    });
    const extendedDescription = visualizationToEmbed(
      scoutTestVisualization,
      extendedPreview,
    )?.data.description;
    expect(extendedDescription).toContain("Champion 11");
    expect(extendedDescription).toContain(
      "additional rows omitted from the stored preview",
    );
    const completePreview = ReportAiPreviewSummarySchema.parse({
      ...preview,
      rows: rows.slice(0, 10),
      visualizationRows: rows.slice(0, 10),
      rowsReturned: 10,
    });
    const completeDescription = visualizationToEmbed(
      scoutTestVisualization,
      completePreview,
    )?.data.description;
    expect(completeDescription).not.toContain(
      "additional rows omitted from the stored preview",
    );
  });

  test("renders sparse and incomplete rows as unknown values", () => {
    const sparseSnapshot = VisualizationSnapshotSchema.parse({
      ...scoutTestVisualization,
      series: [
        {
          ...scoutTestVisualization.series[0],
          points: [scoutTestVisualization.series[0]?.points[0]],
        },
        {
          ...scoutTestVisualization.series[1],
          points: [scoutTestVisualization.series[1]?.points[1]],
        },
      ],
    });
    const sparseDescription =
      visualizationToEmbed(sparseSnapshot)?.data.description;
    expect(sparseDescription).toContain("Aurora    8          Unknown");
    expect(sparseDescription).toContain("Jhin      Unknown    28.6%");

    const incompletePreview = ReportAiPreviewSummarySchema.parse({
      ...preview,
      rows: [
        {
          label: "Aurora",
          values: [{ column: "games", value: 8 }],
        },
      ],
      visualizationRows: [],
      rowsReturned: 1,
    });
    expect(() =>
      visualizationToEmbed(scoutTestVisualization, incompletePreview),
    ).toThrow("Visualization row missing value for win_rate.");
  });

  test("keeps row labels on one Markdown line", () => {
    const newlinePreview = ReportAiPreviewSummarySchema.parse({
      ...preview,
      rows: [
        {
          label: "Aurora\nJhin",
          values: [
            { column: "games", value: 8 },
            { column: "win_rate", value: 1 },
          ],
        },
      ],
      visualizationRows: [],
      rowsReturned: 1,
    });
    const description = visualizationToEmbed(
      VisualizationSnapshotSchema.parse({
        ...scoutTestVisualization,
        kind: "LIST",
      }),
      newlinePreview,
    )?.data.description;
    expect(description).toContain("Aurora Jhin");
    expect(description).not.toContain("Aurora\nJhin");
  });

  test("uses normalized temporal rows and aligned table columns", () => {
    const temporalSnapshot = VisualizationSnapshotSchema.parse({
      ...scoutTestVisualization,
      kind: "TABLE",
      temporal: {
        window: {
          kind: "calendar",
          startDate: "2026-01-01",
          endDate: "2026-01-03",
        },
        bucket: "day",
        timezone: "UTC",
      },
      series: scoutTestVisualization.series.map((series) => ({
        ...series,
        points: [
          ...series.points.map((point) => ({
            ...point,
            comparisonValue: point.value,
            absoluteDelta: 1,
            percentageDelta: 0.5,
            comparisonEvidence: point.evidence,
          })),
          {
            ...series.points[0],
            key: "2026-01-03",
            label: "2026-01-03",
          },
        ],
      })),
    });
    const temporalPreview = ReportAiPreviewSummarySchema.parse({
      ...preview,
      rows: [
        {
          label: "wrong preview order",
          values: [
            { column: "games", value: 1 },
            { column: "win_rate", value: 1 },
          ],
        },
      ],
      visualizationRows: [],
      rowsReturned: 1,
    });
    const description = visualizationToEmbed(temporalSnapshot, temporalPreview)
      ?.data.description;
    expect(description).toContain("Games");
    expect(description).toContain("Aurora");
    expect(description).not.toContain("wrong preview order");
    expect(description).toContain("2026-01-03");
    expect(description).toContain("Baseline:");
    expect(description).toContain("Δ");
    const lines = description?.split("\n") ?? [];
    expect(lines[1]?.length).toBe(lines[2]?.length);
  });

  test("keeps every native description within Discord's limit", () => {
    const longSnapshot = VisualizationSnapshotSchema.parse({
      ...scoutTestVisualization,
      series: scoutTestVisualization.series.map((series) => ({
        ...series,
        label: "Series label ".repeat(200),
        points: series.points.map((point) => ({
          ...point,
          label: "Point label ".repeat(200),
        })),
      })),
    });

    for (const kind of ["TABLE", "LIST", "LEADERBOARD", "KPI_CARD"] as const) {
      const embed = visualizationToEmbed(
        VisualizationSnapshotSchema.parse({
          ...longSnapshot,
          kind,
          title: `${"A title that is too long ".repeat(10)}😀x`,
        }),
      );
      const description = embed?.data.description;
      expect(description).toBeString();
      expect(description?.length).toBeLessThanOrEqual(3900);
      expect(embed?.data.title?.length).toBeLessThanOrEqual(256);
      expect(embed?.data.title).not.toContain("�");
      if (kind === "TABLE") {
        expect(description).toContain("```\n");
        expect(description).not.toContain("Visualization truncated");
      }
    }
  });

  test("still attaches a PNG for chart kinds", () => {
    expect(usesNativeDiscordVisualization(scoutTestBarChart)).toBe(false);
    const payload = exploreVisualizationPayload({
      ...answer,
      visualization: scoutTestBarChart,
    });
    expect(payload.embeds).toBeUndefined();
    expect(payload.files?.[0]?.name).toBe("scout-explore.png");
    expect(payload.files?.[0]?.attachment).toBeInstanceOf(Buffer);
  });
});

test("renders transformed snapshot values instead of raw preview values", () => {
  const snapshot = structuredClone(scoutTestVisualization);
  snapshot.display.cumulative = true;
  snapshot.series.forEach((series) => {
    series.points = series.points.map((point, index) => ({
      ...point,
      value: index === 0 ? 8 : 9,
    }));
  });
  const description = visualizationToEmbed(snapshot, preview)?.data.description;
  expect(description).toContain("9");
  expect(description).not.toContain("7");
});

test("preserves confidence intervals in native temporal rows", () => {
  const snapshot = VisualizationSnapshotSchema.parse({
    ...scoutTestVisualization,
    temporal: {
      window: {
        kind: "relative",
        days: 30,
      },
      bucket: "day",
      timezone: "UTC",
    },
    series: scoutTestVisualization.series.map((series) => ({
      ...series,
      id: `All:${series.id}`,
      points: series.points.map((point) => ({
        ...point,
        key: `${point.key} • ${point.key === "Aurora" ? "solo" : "flex"}`,
        label: `${point.label} • ${point.label === "Aurora" ? "solo" : "flex"}`,
        evidence:
          series.id === "win_rate" && point.key === "Aurora"
            ? {
                ...point.evidence,
                confidenceInterval: {
                  level: 0.95,
                  lower: 0.75,
                  upper: 1,
                },
              }
            : point.evidence,
      })),
    })),
  });

  expect(visualizationToEmbed(snapshot)?.data.description).toContain(
    "95% CI 75.0%–100.0%",
  );
  expect(
    visualizationToEmbed(
      VisualizationSnapshotSchema.parse({ ...snapshot, temporal: null }),
      preview,
    )?.data.description,
  ).toContain("95% CI 75.0%–100.0%");
});

test("preserves evidence when a series dimension contains the display separator", () => {
  const snapshot = VisualizationSnapshotSchema.parse({
    ...scoutTestVisualization,
    series: scoutTestVisualization.series.map((series) => ({
      ...series,
      id: `Queue • Ranked:${series.id}`,
      points: series.points.map((point) => ({
        ...point,
        key: `${point.key} • solo`,
        label: `${point.label} • solo`,
        evidence:
          series.id === "win_rate" && point.key === "Aurora"
            ? {
                ...point.evidence,
                confidenceInterval: {
                  level: 0.95,
                  lower: 0.75,
                  upper: 1,
                },
              }
            : point.evidence,
      })),
    })),
  });
  const aliasedPreview = ReportAiPreviewSummarySchema.parse({
    ...preview,
    rows: preview.rows.map((row) => ({
      ...row,
      label: `Queue • Ranked • ${row.label}`,
    })),
  });

  expect(
    visualizationToEmbed(snapshot, aliasedPreview)?.data.description,
  ).toContain("95% CI 75.0%–100.0%");
});

test("counts emoji-presentation graphemes at their rendered width", () => {
  expect(displayWidth("♥️")).toBe(2);
  expect(displayWidth("©️")).toBe(2);
  expect(displayWidth("🇺🇸")).toBe(2);
  expect(displayWidth("#️⃣")).toBe(2);
  expect(displayWidth("é")).toBe(1);
});

test("chooses the most specific matching series for preview evidence", () => {
  const winRateSeries = scoutTestVisualization.series.find(
    (series) => series.metric === "win_rate",
  );
  if (winRateSeries === undefined) {
    throw new Error("Win rate test series is missing.");
  }
  const point = winRateSeries.points[0];
  if (point === undefined) {
    throw new Error("Win rate test point is missing.");
  }
  const snapshot = VisualizationSnapshotSchema.parse({
    ...scoutTestVisualization,
    series: [
      {
        ...winRateSeries,
        id: "Foo:win_rate",
        points: [
          {
            ...point,
            key: "Bar",
            label: "Bar",
            evidence: {
              ...point.evidence,
              confidenceInterval: {
                level: 0.95,
                lower: 0.1,
                upper: 0.2,
              },
            },
          },
        ],
      },
      {
        ...winRateSeries,
        id: "Foo • Bar:win_rate",
        points: [
          {
            ...point,
            key: "Queue",
            label: "Queue",
            evidence: {
              ...point.evidence,
              confidenceInterval: {
                level: 0.95,
                lower: 0.9,
                upper: 1,
              },
            },
          },
        ],
      },
    ],
  });
  const column = preview.columns.find((item) => item.key === "win_rate");
  if (column === undefined) {
    throw new Error("Win rate preview column is missing.");
  }
  const row = {
    key: "Foo • Bar • Queue",
    label: "Foo • Bar • Queue",
    values: new Map([["win_rate", 1]]),
  };

  expect(formatPreviewValueWithEvidence(snapshot, column, row)).toContain(
    "95% CI 90.0%–100.0%",
  );
  const cappedSnapshot = VisualizationSnapshotSchema.parse({
    ...snapshot,
    series: snapshot.series.slice(0, 1),
  });
  expect(formatPreviewValueWithEvidence(cappedSnapshot, column, row)).toBe(
    "100.0%",
  );
});

test("matches All-series evidence by exact row identity", () => {
  const winRateSeries = scoutTestVisualization.series.find(
    (series) => series.metric === "win_rate",
  );
  if (winRateSeries === undefined) {
    throw new Error("Win rate test series is missing.");
  }
  const sourcePoint = winRateSeries.points[0];
  if (sourcePoint === undefined) {
    throw new Error("Win rate test point is missing.");
  }
  const snapshot = VisualizationSnapshotSchema.parse({
    ...scoutTestVisualization,
    series: [
      {
        ...winRateSeries,
        id: "All:win_rate",
        points: [
          {
            ...sourcePoint,
            key: "Foo",
            label: "Foo",
            evidence: {
              ...sourcePoint.evidence,
              confidenceInterval: {
                level: 0.95,
                lower: 0.1,
                upper: 0.2,
              },
            },
          },
          {
            ...sourcePoint,
            key: "Foo • Bar",
            label: "Foo • Bar",
            evidence: {
              ...sourcePoint.evidence,
              confidenceInterval: {
                level: 0.95,
                lower: 0.9,
                upper: 1,
              },
            },
          },
        ],
      },
    ],
  });
  const column = preview.columns.find((item) => item.key === "win_rate");
  if (column === undefined) {
    throw new Error("Win rate preview column is missing.");
  }

  expect(
    formatPreviewValueWithEvidence(snapshot, column, {
      key: "Foo • Bar",
      label: "Foo • Bar",
      values: new Map([["win_rate", 1]]),
    }),
  ).toContain("95% CI 90.0%–100.0%");
});

test("keeps native values visible when labels exceed the description budget", () => {
  const snapshot = VisualizationSnapshotSchema.parse({
    ...scoutTestVisualization,
    series: scoutTestVisualization.series.map((series) => ({
      ...series,
      label: "Series label ".repeat(500),
      points: series.points.map((point) => ({
        ...point,
        label: "Point label 😀".repeat(500),
      })),
    })),
  });

  for (const kind of ["TABLE", "LIST", "LEADERBOARD"] as const) {
    const description = visualizationToEmbed(
      VisualizationSnapshotSchema.parse({ ...snapshot, kind }),
    )?.data.description;
    expect(description).toContain("100.0%");
    expect(description).not.toContain("�");
  }
});

test("renders percent-stack snapshot values instead of raw preview values", () => {
  const snapshot = structuredClone(scoutTestVisualization);
  snapshot.display.stack = "percent";
  snapshot.series.forEach((series) => {
    series.points = series.points.map((point, index) => ({
      ...point,
      value: index === 0 ? 0.5 : 0.25,
    }));
  });
  const description = visualizationToEmbed(snapshot, preview)?.data.description;
  expect(description).toContain("25.0%");
  expect(description).not.toContain("7");
});
