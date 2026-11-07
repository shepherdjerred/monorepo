import { expect, test } from "bun:test";
import { createSuppliedRangeMissileTargetProjection } from "./latest-supplied-range-missile-target.mjs";
const definition = await Bun.file(
  new URL(
    "../../../../.cache/replay-spike/public/decoder-16.21-macos/missile-motion.json",
    import.meta.url,
  ),
).json();
const projection = createSuppliedRangeMissileTargetProjection(definition);
const inputs = () => ({
  sourcePosition: [100, 20, 100],
  targetPosition: [200, 800, 200],
  range: 750,
  useGroundHeightAtTarget: false,
  terrain: {
    sameMovementCell: () => false,
    sampleHeight: () => ({ inside: true, height: 27 }),
  },
});

test("a same-cell target stays unresolved without inventing facing or querying a height", () => {
  const args = inputs();
  args.terrain.sameMovementCell = () => true;
  args.terrain.sampleHeight = () => {
    throw Error("Unresolved endpoint queried height");
  };
  const result = projection.project(args);
  expect(result).toMatchObject({
    resolved: false,
    status: "unresolved-facing-derived-endpoint",
    position: null,
  });
  expect(args.sourcePosition).toEqual([100, 20, 100]);
  expect(args.targetPosition).toEqual([200, 800, 200]);
});
test("the ground flag cannot bypass the original initial-height query or claim a recovered range", () => {
  const args = inputs();
  let queries = 0;
  args.terrain.sampleHeight = () => {
    queries++;
    return { inside: true, height: 27 };
  };
  const result = projection.project(args);
  expect(queries).toBe(1);
  expect(result.position[1]).toBe(27);
  expect(result.actualCasterRangeRecovered).toBe(false);
  expect(result.actualMatchEndpointAdmitted).toBe(false);
});
test("malformed range/position/terrain contracts fail explicitly", () => {
  for (const mutate of [
    (a) => (a.range = NaN),
    (a) => (a.range = 1e100),
    (a) => (a.sourcePosition = [1, 2]),
    (a) => (a.targetPosition = [1, Infinity, 2]),
    (a) => (a.useGroundHeightAtTarget = 0),
    (a) => (a.terrain.sampleHeight = () => ({ inside: true, height: NaN })),
  ]) {
    const args = inputs();
    mutate(args);
    expect(() => projection.project(args)).toThrow();
  }
});
