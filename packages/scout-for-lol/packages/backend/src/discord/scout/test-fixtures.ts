import { VisualizationSnapshotSchema } from "@scout-for-lol/data";

export const scoutTestVisualization = VisualizationSnapshotSchema.parse({
  version: 1,
  generatedAt: "2026-08-18T00:00:00.000Z",
  kind: "TABLE",
  title: "Win rates",
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
  series: [],
  annotations: [],
  trends: [],
});
