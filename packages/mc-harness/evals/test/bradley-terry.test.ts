import { describe, expect, it } from "vitest";
import {
  fitStrengths,
  rate,
  type PairResult,
} from "#evals/bench/lib/bradley-terry.ts";

const ids = ["x", "y", "z"];

function roundRobin(
  winner: (a: string, b: string) => "a" | "b" | "tie",
  times = 3,
): PairResult[] {
  const pairs: PairResult[] = [];
  for (let round = 0; round < times; round += 1) {
    for (const [i, a] of ids.entries()) {
      for (const b of ids.slice(i + 1)) {
        pairs.push({ a, b, winner: winner(a, b) });
      }
    }
  }
  return pairs;
}

describe("Bradley–Terry", () => {
  it("orders players by who beats whom", () => {
    // x > y > z, alphabetically earlier always wins.
    const pairs = roundRobin((a, b) => (a < b ? "a" : "b"));
    const ratings = rate(ids, pairs, { samples: 50 });
    expect(ratings["x"]!.rating).toBeGreaterThan(ratings["y"]!.rating);
    expect(ratings["y"]!.rating).toBeGreaterThan(ratings["z"]!.rating);
    expect(ratings["x"]!.games).toBe(6);
    expect(ratings["x"]!.wins).toBe(6);
  });

  it("gives equal ratings for all ties and centres them at 1000", () => {
    const ratings = rate(
      ids,
      roundRobin(() => "tie"),
      { samples: 20 },
    );
    for (const id of ids) {
      expect(ratings[id]!.rating).toBeCloseTo(1000, 6);
    }
  });

  it("centres the scale on the anchors", () => {
    const pairs = roundRobin((a, b) => (a < b ? "a" : "b"));
    const strengths = fitStrengths(ids, pairs, ["y"]);
    expect(strengths.get("y")).toBeCloseTo(1, 9);
    const ratings = rate(ids, pairs, { anchors: ["y"], samples: 20 });
    expect(ratings["y"]!.rating).toBeCloseTo(1000, 6);
    expect(ratings["x"]!.rating).toBeGreaterThan(1000);
    expect(ratings["z"]!.rating).toBeLessThan(1000);
  });

  it("bootstraps a deterministic interval that contains the point estimate", () => {
    const mixed = roundRobin(
      (a, b) => (a === "x" ? "a" : b === "z" ? "a" : "tie"),
      4,
    );
    const first = rate(ids, mixed, { samples: 100, seed: 7 });
    const second = rate(ids, mixed, { samples: 100, seed: 7 });
    expect(first).toEqual(second);
    for (const id of ids) {
      expect(first[id]!.lo).toBeLessThanOrEqual(first[id]!.rating + 1e-9);
      expect(first[id]!.hi).toBeGreaterThanOrEqual(first[id]!.rating - 1e-9);
    }
  });
});
