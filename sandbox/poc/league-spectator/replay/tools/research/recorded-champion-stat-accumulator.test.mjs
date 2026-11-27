import { expect, test } from "bun:test";
import { createRecordedChampionStatAccumulator } from "./recorded-champion-stat-accumulator.mjs";

const ids = new Set(Array.from({ length: 10 }, (_, i) => i + 1));
const baseline = [...ids].map((entityId) => ({
  entityId,
  health: 100,
  healthMax: 100,
  resource: 0,
  resourceMax: 0,
  gold: 0,
}));

test("waits for baselines and preserves the final same-clock observation", () => {
  const tracks = createRecordedChampionStatAccumulator(ids, 12);
  tracks.observe(0, [{ entityId: 1, health: 0, resource: 1 }]);
  tracks.observe(1, baseline);
  tracks.observe(2, [{ entityId: 1, health: 110, resource: 10 }]);
  tracks.observe(2, [{ entityId: 1, healthMax: 120, resourceMax: 15 }]);
  tracks.observe(3, [{ entityId: 1, health: 110 }]);
  tracks.observe(4, [{ entityId: 1, health: 0, gold: 2 }]);
  const result = tracks.finish();
  expect(result.championHealthTracks[0]?.points).toEqual([
    [1, 100, 100],
    [2, 110, 120],
    [4, 0, 120],
  ]);
  expect(result.championResourceTracks[0]).toEqual({
    participantId: 1,
    resource: [
      [1, 0, 0],
      [2, 10, 15],
    ],
    gold: [
      [1, 0],
      [4, 2],
    ],
  });
  expect(result.championHealthTracks).toHaveLength(10);
});

test("rejects unresolved actor, invalid scalar, clock, limit, or coverage", () => {
  expect(() => createRecordedChampionStatAccumulator(new Set([1]), 10)).toThrow(
    "ten verified actors",
  );
  const tracks = createRecordedChampionStatAccumulator(ids, 10);
  tracks.observe(1, baseline.slice(0, -1));
  expect(() => tracks.finish()).toThrow("complete roster");
  expect(() => tracks.observe(1, [{ entityId: 11, health: 150 }])).toThrow(
    "Invalid verified",
  );
  expect(() => tracks.observe(1, [{ entityId: 10, health: -1 }])).toThrow(
    "Invalid verified",
  );
  expect(() => tracks.observe(1, undefined)).toThrow("writes are missing");
  expect(() => tracks.observe(0, [])).toThrow(
    "Invalid champion stat packet clock",
  );
  expect(() => tracks.observe(11, [])).toThrow(
    "Invalid champion stat packet clock",
  );
  tracks.observe(2, [baseline.at(-1), { entityId: 1, health: 101 }]);
  expect(() => tracks.finish()).toThrow("exceed the maximum");
});
