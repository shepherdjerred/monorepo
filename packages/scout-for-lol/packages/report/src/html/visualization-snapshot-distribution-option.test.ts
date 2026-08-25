import { describe, expect, test } from "vitest";
import {
  VisualizationSnapshotSchema,
  type TemporalSeries,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import {
  boxPlotOption,
  histogramOption,
} from "#src/html/visualization-snapshot-distribution-option.ts";
import { visualizationSnapshotToOption } from "#src/html/visualization-snapshot-option.ts";

describe("histogram visualization options", () => {
  test("renders bucket labels and counts as gapless bars in query order", () => {
    const option = histogramOption(
      snapshot("HISTOGRAM", [
        series("duration", "Games", [
          ["b0", "0–299", 4],
          ["b1", "300–599", 11],
          ["b2", "600–899", 7],
        ]),
      ]),
      "static",
    );
    const json = JSON.stringify(option);

    expect(json).toContain('"data":["0–299","300–599","600–899"]');
    expect(json).toContain('"data":[4,11,7]');
    expect(json).toContain('"barCategoryGap":0');
    expect(json).toContain('"barGap":"0%"');
    expect(json).toContain('"borderWidth":1');
    expect(json).toContain('"type":"category"');
  });

  test("renders only the first series of a multi-series histogram snapshot", () => {
    const option = histogramOption(
      snapshot("HISTOGRAM", [
        series("duration", "Games", [
          ["b0", "0–299", 4],
          ["b1", "300–599", 11],
        ]),
        series("ignored", "Second distribution", [
          ["c0", "900–1199", 99],
          ["c1", "1200–1499", 98],
        ]),
      ]),
      "static",
    );
    const json = JSON.stringify(option);

    expect(Array.isArray(option.series) ? option.series : []).toHaveLength(1);
    expect(json).toContain('"name":"Games"');
    expect(json).not.toContain("Second distribution");
    expect(json).not.toContain("900–1199");
  });

  test("renders no series for a histogram snapshot with no distribution", () => {
    const option = histogramOption(snapshot("HISTOGRAM", []), "static");

    expect(Array.isArray(option.series) ? option.series : []).toHaveLength(0);
  });
});

describe("box plot visualization options", () => {
  test("zips the five encoded series by point key, not by index", () => {
    const option = boxPlotOption(
      boxPlotSnapshot([
        ["b1", "Ahri", 1],
        ["b2", "Garen", 10],
      ]),
      "static",
    );
    const json = JSON.stringify(option);

    expect(json).toContain('"data":["Ahri","Garen"]');
    expect(json).toContain('"data":[[1,2,3,4,5],[10,20,30,40,50]]');
  });

  test("skips a category missing from any of the five encoded series", () => {
    const option = boxPlotOption(
      boxPlotSnapshot(
        [
          ["b1", "Ahri", 1],
          ["b2", "Garen", 10],
          ["b3", "Zed", 100],
        ],
        "b2",
      ),
      "static",
    );
    const json = JSON.stringify(option);

    expect(json).toContain('"data":["Ahri","Zed"]');
    expect(json).toContain('"data":[[1,2,3,4,5],[100,200,300,400,500]]');
    expect(json).not.toContain("Garen");
  });

  test("refuses a snapshot that does not carry the five-series encoding", () => {
    expect(() =>
      boxPlotOption(
        snapshot("BOX_PLOT", [
          series("min", "min", [["b1", "Ahri", 1]]),
          series("q1", "q1", [["b1", "Ahri", 2]]),
          series("median", "median", [["b1", "Ahri", 3]]),
          series("q3", "q3", [["b1", "Ahri", 4]]),
        ]),
        "static",
      ),
    ).toThrow(
      "A BOX_PLOT snapshot must carry exactly 5 series encoding (min, q1, median, q3, max); received 4.",
    );
  });
});

describe("distribution rendering modes", () => {
  test("routes both distribution kinds through the snapshot dispatch", () => {
    const histogram = visualizationSnapshotToOption(
      snapshot("HISTOGRAM", [
        series("duration", "Games", [["b0", "0–299", 4]]),
      ]),
      "static",
    );
    const boxPlot = visualizationSnapshotToOption(
      boxPlotSnapshot([["b1", "Ahri", 1]]),
      "static",
    );

    expect(JSON.stringify(histogram)).toContain('"barCategoryGap":0');
    expect(JSON.stringify(boxPlot)).toContain('"type":"boxplot"');
  });

  test("keeps histogram data identical across interactive and static modes", () => {
    const input = snapshot("HISTOGRAM", [
      series("duration", "Games", [
        ["b0", "0–299", 4],
        ["b1", "300–599", 11],
      ]),
    ]);
    const staticOption = visualizationSnapshotToOption(input, "static");
    const interactiveOption = visualizationSnapshotToOption(
      input,
      "interactive",
    );

    expect(JSON.stringify(interactiveOption.series)).toBe(
      JSON.stringify(staticOption.series),
    );
    expect(JSON.stringify(interactiveOption.xAxis)).toBe(
      JSON.stringify(staticOption.xAxis),
    );
    expect(interactiveOption.dataZoom).toBeDefined();
    expect(staticOption.dataZoom).toBeUndefined();
    expect(staticOption.toolbox).toBeUndefined();
  });

  test("keeps box plot data identical across interactive and static modes", () => {
    const input = boxPlotSnapshot([
      ["b1", "Ahri", 1],
      ["b2", "Garen", 10],
    ]);
    const staticOption = visualizationSnapshotToOption(input, "static");
    const interactiveOption = visualizationSnapshotToOption(
      input,
      "interactive",
    );

    expect(JSON.stringify(interactiveOption.series)).toBe(
      JSON.stringify(staticOption.series),
    );
    expect(JSON.stringify(interactiveOption.xAxis)).toBe(
      JSON.stringify(staticOption.xAxis),
    );
    expect(interactiveOption.dataZoom).toBeDefined();
    expect(staticOption.dataZoom).toBeUndefined();
  });
});

const BOX_PLOT_ENCODING = ["min", "q1", "median", "q3", "max"];

/**
 * Builds the documented `y = (min, q1, median, q3, max)` encoding as five
 * series whose points are deliberately shuffled per series, so a renderer that
 * zipped by index instead of by key would produce visibly wrong boxes.
 */
function boxPlotSnapshot(
  buckets: [string, string, number][],
  omittedKey?: string,
): VisualizationSnapshot {
  return snapshot(
    "BOX_PLOT",
    BOX_PLOT_ENCODING.map((encoding, position) => {
      const points = buckets.flatMap(
        ([key, label, base]): [string, string, number][] =>
          key === omittedKey && position > 0
            ? []
            : [[key, label, base * (position + 1)]],
      );
      return series(
        encoding,
        encoding,
        position % 2 === 0 ? points : points.toReversed(),
      );
    }),
  );
}

function snapshot(
  kind: string,
  seriesItems: TemporalSeries[],
): VisualizationSnapshot {
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
  id: string,
  label: string,
  points: [string, string, number][],
): TemporalSeries {
  return {
    id,
    label,
    metric: "games",
    additive: true,
    points: points.map(([key, pointLabel, value]) => ({
      key,
      label: pointLabel,
      start: "2026-08-08T00:00:00.000Z",
      end: "2026-08-08T23:59:59.999Z",
      value,
      evidence: { sampleSize: 1, confidenceInterval: null },
    })),
  };
}
