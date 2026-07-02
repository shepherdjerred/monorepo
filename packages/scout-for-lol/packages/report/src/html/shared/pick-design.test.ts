import { test, expect } from "bun:test";
import { rankedFixture } from "#src/html/shared/test-fixtures.ts";
import { pickRankedDesign } from "#src/html/shared/pick-design.ts";

test("pickRankedDesign is deterministic for the same match", () => {
  const match = rankedFixture({
    queueType: "solo",
    trackedCount: 1,
    outcome: "Victory",
  });
  const first = pickRankedDesign(match);
  const second = pickRankedDesign(match);
  expect(first).toBe(second);
});

test("pickRankedDesign splits roughly 50/50 across many distinct matches", () => {
  // Vary the durationInSeconds to produce many distinct stable hashes
  // without rebuilding the fixture (which is the expensive part).
  const base = rankedFixture({
    queueType: "solo",
    trackedCount: 1,
    outcome: "Victory",
  });

  const counts = { banner: 0, square: 0 };
  for (let i = 0; i < 500; i++) {
    const design = pickRankedDesign({ ...base, durationInSeconds: 1000 + i });
    counts[design]++;
  }

  // Expect each design to take 35-65% of the sample (very loose bound — we
  // only care that the picker isn't pathologically biased).
  expect(counts.banner).toBeGreaterThan(175);
  expect(counts.banner).toBeLessThan(325);
  expect(counts.square).toBeGreaterThan(175);
  expect(counts.square).toBeLessThan(325);
});
