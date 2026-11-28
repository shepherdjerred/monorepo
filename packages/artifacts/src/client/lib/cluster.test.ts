import { describe, expect, test } from "vitest";
import { clusterPins } from "./cluster.ts";

describe("clusterPins", () => {
  test("keeps distant pins apart", () => {
    const clusters = clusterPins([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
    ]);
    expect(clusters.map((cluster) => cluster.ids)).toEqual([["a"], ["b"]]);
  });

  test("merges pins within 24 px and averages their position", () => {
    const clusters = clusterPins([
      { id: "a", x: 10, y: 10 },
      { id: "b", x: 30, y: 10 },
      { id: "c", x: 200, y: 200 },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toEqual({ x: 20, y: 10, ids: ["a", "b"] });
  });

  test("a pin exactly 24 px away joins, 25 px does not", () => {
    expect(
      clusterPins([
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 24, y: 0 },
      ]),
    ).toHaveLength(1);
    expect(
      clusterPins([
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 25, y: 0 },
      ]),
    ).toHaveLength(2);
  });

  test("compares to the cluster's first pin so a chain does not collapse", () => {
    const clusters = clusterPins([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 20, y: 0 },
      { id: "c", x: 40, y: 0 },
    ]);
    expect(clusters.map((cluster) => cluster.ids)).toEqual([["a", "b"], ["c"]]);
  });
});
