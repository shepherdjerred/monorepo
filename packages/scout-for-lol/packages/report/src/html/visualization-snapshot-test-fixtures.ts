import {
  VisualizationSnapshotSchema,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";

type SnapshotFixtureInput = Pick<VisualizationSnapshot, "kind" | "series"> &
  Partial<Omit<VisualizationSnapshot, "kind" | "series" | "version">>;

export function visualizationSnapshotFixture(
  input: SnapshotFixtureInput,
): VisualizationSnapshot {
  return VisualizationSnapshotSchema.parse({
    version: 1,
    generatedAt: "2026-08-08T00:00:00.000Z",
    title: null,
    temporal: null,
    bucket: null,
    annotations: [],
    trends: [],
    ...input,
    display: {
      theme: null,
      palette: null,
      smooth: false,
      stack: "none",
      rollingWindow: null,
      cumulative: false,
      sparkline: false,
      ...input.display,
    },
  });
}
