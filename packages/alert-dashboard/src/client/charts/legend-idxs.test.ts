import { describe, expect, it } from "vitest";

import { restingLegendIdxs } from "./legend-idxs.ts";

describe("restingLegendIdxs", () => {
  it("points every series at its last sample", () => {
    expect(
      restingLegendIdxs([
        [10, 20, 30],
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toEqual([2, 2, 2]);
  });

  it("skips trailing gaps, one series at a time", () => {
    expect(
      restingLegendIdxs([
        [10, 20, 30, 40],
        [1, 2, null, null],
        [null, 5, 6, null],
      ]),
    ).toEqual([2, 1, 2]);
  });

  it("counts zero as a sample", () => {
    expect(
      restingLegendIdxs([
        [10, 20],
        [3, 0],
      ]),
    ).toEqual([1, 1]);
  });

  it("leaves a series without samples, and a chart without series, unset", () => {
    expect(
      restingLegendIdxs([
        [10, 20],
        [null, null],
        [7, null],
      ]),
    ).toEqual([0, null, 0]);
    expect(restingLegendIdxs([[10, 20]])).toEqual([null]);
    expect(restingLegendIdxs([[]])).toEqual([null]);
  });
});
