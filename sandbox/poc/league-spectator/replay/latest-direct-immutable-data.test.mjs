import { test, expect } from "bun:test";
import {
  isDirectImmutableData,
  freezeDirectOwnedData,
  createDirectOwnedDataFreezer,
  protectDirectDataGraph,
} from "./latest-direct-immutable-data.mjs";

test("only completely immutable own-data graphs qualify for identity reuse", () => {
  const owned = freezeDirectOwnedData({ source: { position: [-0, 2] } });
  expect(isDirectImmutableData(owned)).toBe(true);
  expect(Object.isFrozen(owned.source.position)).toBe(true);
  expect(Object.is(owned.source.position[0], -0)).toBe(true);
  for (const child of [
    { position: [1] },
    new Uint8Array([1]),
    new ArrayBuffer(1),
    new Map(),
  ]) {
    expect(isDirectImmutableData(Object.freeze({ child }))).toBe(false);
  }
  let invoked = false;
  const accessor = Object.freeze({
    get child() {
      invoked = true;
      return 1;
    },
  });
  expect(isDirectImmutableData(accessor)).toBe(false);
  expect(invoked).toBe(false);
});

test("a full-match freeze batch visits shared owned subgraphs once and preserves protected mutable aliases", () => {
  const shared = {
      source: Array.from({ length: 4096 }, (_, id) => ({
        id,
        value: [id, -0],
      })),
    },
    mutableReasons = ["original omission"],
    protection = new WeakSet();
  protectDirectDataGraph({ reasons: mutableReasons }, protection);
  const freezer = createDirectOwnedDataFreezer(protection),
    count = 100760;
  for (let index = 0; index < count; index++) freezer.freeze({ index, shared });
  const metrics = freezer.metrics();
  expect(metrics.reused).toBe(count - 1);
  expect(metrics.visited).toBe(count + 2 + 4096 * 2);
  expect(Object.isFrozen(shared.source[0].value)).toBe(true);
  const aliased = { shared, mutableReasons };
  freezer.freeze(aliased);
  expect(Object.isFrozen(aliased)).toBe(false);
  expect(Object.isFrozen(mutableReasons)).toBe(false);
  mutableReasons.push("actual linked removal");
  expect(aliased.mutableReasons).toHaveLength(2);
});

test("batch certification cannot leak from a rejected cyclic graph or mutable backing store", () => {
  const freezer = createDirectOwnedDataFreezer(),
    root = {},
    child = { root };
  root.child = child;
  root.mutable = new Uint8Array([1]);
  freezer.freeze(root);
  expect(Object.isFrozen(child)).toBe(false);
  expect(freezer.metrics().certified).toBe(0);
  root.mutable[0] = 2;
  freezer.freeze(child);
  expect(Object.isFrozen(root)).toBe(false);
  expect(freezer.metrics().certified).toBe(0);
});

test("rejected cyclic graphs cannot certify their frozen children", () => {
  const root = {},
    child = { root };
  root.child = Object.freeze(child);
  root.mutable = { position: 1 };
  Object.freeze(root);
  expect(isDirectImmutableData(root)).toBe(false);
  expect(isDirectImmutableData(child)).toBe(false);
  const cycle = {};
  cycle.self = cycle;
  freezeDirectOwnedData(cycle);
  expect(isDirectImmutableData(cycle)).toBe(true);
});

test("owned graphs with mutable backing stores remain uncached without partial freezing", () => {
  const row = { own: { x: 1 }, view: new Float32Array([1]) };
  expect(freezeDirectOwnedData(row)).toBe(row);
  expect(Object.isFrozen(row.own)).toBe(false);
  expect(isDirectImmutableData(row)).toBe(false);
});
