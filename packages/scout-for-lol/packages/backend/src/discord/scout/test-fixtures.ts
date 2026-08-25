import { VisualizationSnapshotSchema } from "@scout-for-lol/data";

const display = {
  theme: null,
  palette: null,
  smooth: false,
  stack: "none" as const,
  rollingWindow: null,
  cumulative: false,
  sparkline: false,
};

function point(label: string, value: number, sampleSize = 8) {
  return {
    key: label,
    label,
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-01-02T00:00:00.000Z",
    value,
    evidence: { games: sampleSize, sampleSize },
  };
}

export const scoutTestVisualization = VisualizationSnapshotSchema.parse({
  version: 1,
  generatedAt: "2026-08-18T00:00:00.000Z",
  kind: "TABLE",
  title: "Win rates",
  temporal: null,
  bucket: null,
  display,
  series: [
    {
      id: "games",
      label: "Games",
      metric: "games",
      additive: true,
      points: [point("Aurora", 8), point("Jhin", 7)],
    },
    {
      id: "win_rate",
      label: "Win rate",
      metric: "win_rate",
      additive: false,
      points: [point("Aurora", 1), point("Jhin", 0.286)],
    },
  ],
  annotations: [],
  trends: [],
});

export const scoutTestLeaderboard = VisualizationSnapshotSchema.parse({
  ...scoutTestVisualization,
  kind: "LEADERBOARD",
  title: "Vision score per game",
});

export const scoutTestKpi = VisualizationSnapshotSchema.parse({
  version: 1,
  generatedAt: "2026-08-18T00:00:00.000Z",
  kind: "KPI_CARD",
  title: "Games for lolop#dog",
  temporal: null,
  bucket: null,
  display,
  series: [
    {
      id: "games",
      label: "Games counted",
      metric: "games",
      additive: true,
      points: [point("earlier", 42), point("total", 56, 56)],
    },
  ],
  annotations: [],
  trends: [],
});

export const scoutTestBarChart = VisualizationSnapshotSchema.parse({
  ...scoutTestVisualization,
  kind: "BAR_CHART",
  title: "Vision score per game",
  series: [
    {
      id: "vision",
      label: "Vision / game",
      metric: "vision_score",
      additive: false,
      points: [point("Francesca#000", 79.8, 31)],
    },
  ],
});
