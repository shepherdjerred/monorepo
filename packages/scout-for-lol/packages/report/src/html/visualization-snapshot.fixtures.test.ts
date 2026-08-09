import { afterAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  VisualizationSnapshotSchema,
  type TemporalSeriesPoint,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import {
  visualizationSnapshotToImage,
  visualizationSnapshotToSvg,
} from "#src/html/visualization-snapshot-image.ts";
import { visualizationSnapshotToOption } from "#src/html/visualization-snapshot-option.ts";

const OUTPUT_DIR = path.resolve(
  import.meta.dir,
  "../../test-output/visualization-snapshot",
);
const writtenFiles: string[] = [];
await mkdir(OUTPUT_DIR, { recursive: true });

afterAll(() => {
  expect(writtenFiles).toHaveLength(4);
});

function point(
  date: string,
  value: number,
  sampleSize: number,
): TemporalSeriesPoint {
  return {
    key: date,
    label: date,
    start: `${date}T00:00:00.000Z`,
    end: `${date}T23:59:59.999Z`,
    value,
    comparisonValue: value - 0.05,
    absoluteDelta: 0.05,
    percentageDelta: value / (value - 0.05) - 1,
    evidence: {
      sampleSize,
      ...(value >= 0 && value <= 1
        ? {
            successes: Math.round(value * sampleSize),
            confidenceInterval: {
              level: 0.95 as const,
              lower: Math.max(0, value - 0.12),
              upper: Math.min(1, value + 0.12),
            },
          }
        : { confidenceInterval: null }),
    },
    comparisonEvidence: {
      sampleSize,
      ...(value >= 0 && value <= 1
        ? {
            successes: Math.round((value - 0.05) * sampleSize),
            confidenceInterval: null,
          }
        : { confidenceInterval: null }),
    },
  };
}

function baseSnapshot(
  input: Pick<VisualizationSnapshot, "kind" | "title" | "series"> &
    Partial<VisualizationSnapshot>,
): VisualizationSnapshot {
  return VisualizationSnapshotSchema.parse({
    version: 1,
    generatedAt: "2026-08-08T12:00:00.000Z",
    temporal: {
      window: { kind: "relative", days: 30 },
      bucket: "day",
      comparison: { kind: "previous_period" },
      timezone: "UTC",
    },
    bucket: "day",
    display: {
      theme: "lol_dark",
      palette: "ranked",
      smooth: true,
      stack: "none",
      rollingWindow: null,
      cumulative: false,
      sparkline: false,
    },
    annotations: [],
    trends: [],
    ...input,
  });
}

async function renderFixture(
  filename: string,
  snapshot: VisualizationSnapshot,
): Promise<void> {
  const svg = visualizationSnapshotToSvg(snapshot);
  const image = visualizationSnapshotToImage(snapshot);
  const staticOption = visualizationSnapshotToOption(snapshot, "static");
  const interactiveOption = visualizationSnapshotToOption(
    snapshot,
    "interactive",
  );
  expect(svg).toContain("<svg");
  expect(image.length).toBeGreaterThan(4096);
  expect(interactiveOption.series).toEqual(staticOption.series);
  expect(interactiveOption.xAxis).toEqual(staticOption.xAxis);
  expect(interactiveOption.yAxis).toEqual(staticOption.yAxis);
  const output = path.join(OUTPUT_DIR, filename);
  await Bun.write(output, image);
  writtenFiles.push(output);
}

test("renders comparison evidence, annotations, trend, and sparkline metadata", async () => {
  const points = [
    point("2026-08-01", 0.45, 20),
    point("2026-08-02", 0.52, 31),
    point("2026-08-03", 0.61, 18),
    point("2026-08-04", 0.58, 26),
  ];
  await renderFixture(
    "01-comparison-confidence-trend-sparkline.png",
    baseSnapshot({
      kind: "LINE_CHART",
      title: "Win rate with evidence",
      display: {
        theme: "lol_dark",
        palette: "ranked",
        smooth: true,
        stack: "none",
        rollingWindow: 3,
        cumulative: false,
        sparkline: true,
      },
      series: [
        {
          id: "all:win_rate",
          label: "Win rate",
          metric: "win_rate",
          additive: false,
          points,
        },
      ],
      annotations: [
        {
          id: "patch-26.16",
          kind: "patch_transition",
          timestamp: "2026-08-03T00:00:00.000Z",
          label: "Patch 26.16",
        },
      ],
      trends: [
        {
          seriesId: "all:win_rate",
          slope: 0.045,
          rSquared: 0.78,
          values: [0.46, 0.505, 0.55, 0.595],
        },
      ],
    }),
  );
});

test("renders a percentage stack with cumulative values", async () => {
  const dates = ["2026-08-01", "2026-08-02", "2026-08-03"];
  await renderFixture(
    "02-percent-stack-cumulative.png",
    baseSnapshot({
      kind: "AREA_CHART",
      title: "Queue composition",
      display: {
        theme: "lol_dark",
        palette: "team",
        smooth: false,
        stack: "percent",
        rollingWindow: null,
        cumulative: true,
        sparkline: false,
      },
      series: [
        {
          id: "solo:games",
          label: "Solo",
          metric: "games",
          additive: true,
          points: dates.map((date, index) =>
            point(date, 0.6 + index * 0.05, 10),
          ),
        },
        {
          id: "flex:games",
          label: "Flex",
          metric: "games",
          additive: true,
          points: dates.map((date, index) =>
            point(date, 0.4 - index * 0.05, 10),
          ),
        },
      ],
    }),
  );
});

test("renders competition rank bump and daily calendar fixtures", async () => {
  const dates = ["2026-08-01", "2026-08-02", "2026-08-03"];
  await renderFixture(
    "03-rank-bump.png",
    baseSnapshot({
      kind: "BUMP_CHART",
      title: "Competition rank movement",
      series: [
        {
          id: "rank:1",
          label: "Astra",
          metric: "rank_position",
          additive: false,
          points: dates.map((date, index) =>
            point(date, [3, 1, 2][index] ?? 1, 1),
          ),
        },
        {
          id: "rank:2",
          label: "Dragon",
          metric: "rank_position",
          additive: false,
          points: dates.map((date, index) =>
            point(date, [1, 2, 1][index] ?? 1, 1),
          ),
        },
      ],
    }),
  );
  await renderFixture(
    "04-calendar-heatmap.png",
    baseSnapshot({
      kind: "CALENDAR_HEATMAP",
      title: "Daily activity",
      series: [
        {
          id: "all:games",
          label: "Games",
          metric: "games",
          additive: true,
          points: dates.map((date, index) => point(date, (index + 1) * 7, 7)),
        },
      ],
    }),
  );
});
