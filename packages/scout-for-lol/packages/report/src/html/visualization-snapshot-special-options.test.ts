import { describe, expect, test } from "bun:test";
import {
  VisualizationSnapshotSchema,
  type TemporalSeries,
} from "@scout-for-lol/data";
import {
  donutOption,
  radarOption,
} from "#src/html/visualization-snapshot-special-options.ts";

describe("visualization snapshot special options", () => {
  test("renders every multidimensional donut series", () => {
    const option = donutOption(
      snapshot("DONUT_CHART", [
        series("solo — games", "games", [["Ahri", 3]]),
        series("flex — games", "games", [["Garen", 2]]),
      ]),
    );
    const json = JSON.stringify(option);

    expect(json).toContain('"name":"solo • Ahri","value":3');
    expect(json).toContain('"name":"flex • Garen","value":2');
  });

  test("uses selected metrics as radar axes and grouped rows as polygons", () => {
    const option = radarOption(
      snapshot("RADAR_CHART", [
        series("games", "games", [
          ["Alpha", 10],
          ["Beta", 5],
        ]),
        series("wins", "wins", [
          ["Alpha", 7],
          ["Beta", 2],
        ]),
        series("win_rate", "win_rate", [
          ["Alpha", 0.7],
          ["Beta", 0.4],
        ]),
      ]),
    );
    const json = JSON.stringify(option);

    expect(json).toContain(
      '"indicator":[{"name":"games","max":10},{"name":"wins","max":7},{"name":"win_rate","max":1}]',
    );
    expect(json).toContain('"name":"Alpha","value":[10,7,0.7]');
    expect(json).toContain('"name":"Beta","value":[5,2,0.4]');
  });
});

function snapshot(kind: string, seriesItems: TemporalSeries[]) {
  return VisualizationSnapshotSchema.parse({
    version: 1,
    generatedAt: "2026-08-08T00:00:00.000Z",
    kind,
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
    series: seriesItems,
    annotations: [],
    trends: [],
  });
}

function series(
  label: string,
  metric: string,
  values: [string, number][],
): TemporalSeries {
  return {
    id: `${label}:${metric}`,
    label,
    metric,
    additive: true,
    points: values.map(([pointLabel, value], index) => ({
      key: pointLabel,
      label: pointLabel,
      start: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      end: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      value,
      evidence: { sampleSize: 1, confidenceInterval: null },
    })),
  };
}
