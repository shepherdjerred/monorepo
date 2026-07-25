import { afterAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  analyticsChartToImage,
  type AnalyticsChartProps,
} from "#src/html/analytics-chart.ts";

const OUTPUT_DIR = path.resolve(
  import.meta.dir,
  "../../test-output/analytics-chart",
);
const writtenFiles: string[] = [];
await mkdir(OUTPUT_DIR, { recursive: true });

afterAll(() => {
  console.log(`Rendered analytics fixtures:\n${writtenFiles.join("\n")}`);
});

async function renderFixture(
  filename: string,
  props: AnalyticsChartProps,
): Promise<void> {
  const data = analyticsChartToImage(props);
  const output = path.join(OUTPUT_DIR, filename);
  await Bun.write(output, data);
  writtenFiles.push(output);
  expect(data.length).toBeGreaterThan(4096);
}

const CATEGORIES = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"];
const RESULTS = [
  { name: "Wins", values: [18, 23, 21, 28, 31] },
  { name: "Losses", values: [15, 12, 17, 13, 11] },
];

test("renders the analytics chart gallery", async () => {
  await renderFixture("01-stacked-bar.png", {
    chartType: "stacked_bar",
    title: "Weekly Results",
    subtitle: "Wins and losses over the last five weeks",
    categories: CATEGORIES,
    series: RESULTS,
    palette: "team",
    labels: "value",
    legend: "bottom",
  });
  await renderFixture("02-area-light.png", {
    chartType: "area",
    title: "Server Activity",
    categories: CATEGORIES,
    series: [{ name: "Games", values: [33, 35, 38, 41, 42] }],
    theme: "minimal_light",
    palette: "colorblind",
    smooth: true,
    yAxisLabel: "Games",
  });
  await renderFixture("03-donut.png", {
    chartType: "donut",
    title: "Recent Outcomes",
    items: [
      { name: "Wins", value: 62 },
      { name: "Losses", value: 38 },
    ],
    palette: "team",
    labels: "percent",
  });
  await renderFixture("04-scatter.png", {
    chartType: "scatter",
    title: "Combat Efficiency",
    xAxisLabel: "Damage per game",
    yAxisLabel: "KDA",
    palette: "colorblind",
    points: [
      { name: "Astra", x: 28_400, y: 3.8, size: 44 },
      { name: "Braum Main", x: 17_200, y: 5.2, size: 31 },
      { name: "Carry Diff", x: 31_100, y: 2.9, size: 56 },
      { name: "Dragon", x: 24_900, y: 4.4, size: 27 },
    ],
  });
  await renderFixture("05-heatmap.png", {
    chartType: "heatmap",
    title: "Champion Position Win Rate",
    xCategories: ["Ashe", "Ahri", "Lee Sin", "Ornn"],
    yCategories: ["TOP", "JUNGLE", "MIDDLE", "BOTTOM"],
    cells: Array.from({ length: 16 }, (_, index) => ({
      x: index % 4,
      y: Math.floor(index / 4),
      value: 42 + ((index * 7) % 19),
    })),
    valueSuffix: "%",
    palette: "ranked",
    labels: "value",
  });
  await renderFixture("06-radar.png", {
    chartType: "radar",
    title: "Champion Profiles",
    indicators: ["Kills", "Assists", "Damage", "Vision", "Objectives"],
    series: [
      { name: "Ahri", values: [8.2, 7.1, 29, 18, 5.4] },
      { name: "Orianna", values: [6.4, 9.8, 26, 23, 7.2] },
      { name: "Syndra", values: [9.1, 5.9, 33, 15, 4.8] },
    ],
    legend: "right",
    palette: "categorical",
  });
  await renderFixture("07-kpi.png", {
    chartType: "kpi",
    title: "30-day Snapshot",
    theme: "minimal_dark",
    items: [
      { label: "Games", value: "1,284" },
      { label: "Win rate", value: "52.4%" },
      { label: "KDA", value: "3.18" },
      { label: "Avg game length", value: "28.7" },
    ],
  });
});
