import { test, expect } from "bun:test";
import {
  isDirectImmutableData,
  freezeDirectOwnedData,
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
