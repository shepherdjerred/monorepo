import { describe, expect, test } from "bun:test";
import { resolveHeatmapAxes } from "#src/reports/output.ts";

describe("resolveHeatmapAxes", () => {
  const groupBys = ["champion", "team_position"];

  test("defaults to query order when no encoding is given", () => {
    expect(resolveHeatmapAxes(groupBys, {})).toEqual({ xDim: 0, yDim: 1 });
  });

  test("x naming the first dimension keeps query order", () => {
    expect(resolveHeatmapAxes(groupBys, { x: "champion" })).toEqual({
      xDim: 0,
      yDim: 1,
    });
  });

  test("x naming the second dimension flips the axes", () => {
    expect(resolveHeatmapAxes(groupBys, { x: "team_position" })).toEqual({
      xDim: 1,
      yDim: 0,
    });
  });

  test("preset x + series (x = first, series = second) keeps query order", () => {
    expect(
      resolveHeatmapAxes(groupBys, {
        x: "champion",
        series: "team_position",
      }),
    ).toEqual({ xDim: 0, yDim: 1 });
  });

  test("flipped x + series puts the requested dimension on x", () => {
    expect(
      resolveHeatmapAxes(groupBys, {
        x: "team_position",
        series: "champion",
      }),
    ).toEqual({ xDim: 1, yDim: 0 });
  });

  test("series alone drives the y-axis, x becomes its complement", () => {
    expect(resolveHeatmapAxes(groupBys, { series: "champion" })).toEqual({
      xDim: 1,
      yDim: 0,
    });
  });

  test("an unresolvable channel (e.g. label) falls back to query order", () => {
    expect(resolveHeatmapAxes(groupBys, { x: "label" })).toEqual({
      xDim: 0,
      yDim: 1,
    });
  });
});
