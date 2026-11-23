import { expect, test } from "bun:test";
import { sameCheckpointData } from "./checkpoint-data-equality.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";

test("memoized checkpoint comparison preserves scalar and raw typed-byte distinctions", () => {
  const samples = [
    null,
    undefined,
    true,
    false,
    0,
    -0,
    1,
    "1",
    [1, -0],
    { v: new Float32Array([1, -0]) },
    { v: new Uint8Array([1, 2]) },
    { v: [1, 2] },
  ];
  for (const a of samples)
    for (const b of samples)
      expect(sameCheckpointData(a, b)).toBe(sameDirectCompiledData(a, b));
  const backing = new Uint8Array([0, 1, 2, 0]);
  expect(
    sameCheckpointData(backing.subarray(1, 3), new Uint8Array([1, 2])),
  ).toBe(true);
  expect(
    sameCheckpointData(new Float32Array([0]), new Float32Array([-0])),
  ).toBe(false);
});

test("large repeated native metadata stays exact without expanding a shared graph", () => {
  let graph = {
    values: new Float32Array([1, -0, 0.5]),
    name: "immutable-native-metadata",
  };
  for (let i = 0; i < 11; i++)
    graph = { a: graph, b: graph, c: graph, d: graph };
  const other = structuredClone(graph);
  expect(sameCheckpointData(graph, other)).toBe(true);
  let changed = other;
  for (let i = 0; i < 11; i++) changed = changed.a;
  changed.values[2] = 0.25;
  expect(sameCheckpointData(graph, other)).toBe(false);
  expect(
    sameCheckpointData(
      { a: graph, b: graph },
      { a: structuredClone(graph), b: structuredClone(graph) },
    ),
  ).toBe(true);
});

test("checkpoint comparisons reject accessors, unsupported objects and cycles", () => {
  const accessor = {
    get value() {
      throw Error("must not execute");
    },
  };
  expect(sameCheckpointData(accessor, accessor)).toBe(false);
  expect(sameCheckpointData(new Date(0), new Date(0))).toBe(false);
  const cycle = {};
  cycle.self = cycle;
  expect(sameCheckpointData(cycle, structuredClone(cycle))).toBe(false);
});
