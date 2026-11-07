import { expect, test } from "bun:test";
import { createDirectPoseEvidenceSnapshots } from "./latest-direct-pose-evidence-snapshots.mjs";

test("shared immutable placement evidence is copied once into runtime ownership", () => {
  const evidence = Object.freeze({
    source: Object.freeze({ keys: Object.freeze([1, 2]) }),
  });
  const snapshot = createDirectPoseEvidenceSnapshots();
  const first = snapshot(evidence);
  expect(first).toEqual(evidence);
  expect(first).not.toBe(evidence);
  expect(first.source).not.toBe(evidence.source);
  expect(snapshot(evidence)).toBe(first);
  expect(Object.isFrozen(first.source.keys)).toBe(true);
  expect(() => first.source.keys.push(3)).toThrow();
  expect(createDirectPoseEvidenceSnapshots()(evidence)).not.toBe(first);
});

test("mutable nested data cannot inherit a frozen parent's reuse", () => {
  const source = { key: 1 };
  for (const evidence of [{ source }, Object.freeze({ source })]) {
    const snapshot = createDirectPoseEvidenceSnapshots();
    const first = snapshot(evidence);
    source.key++;
    const second = snapshot(evidence);
    expect(second).not.toBe(first);
    expect(second.source.key).toBe(source.key);
    expect(first.source.key).toBe(source.key - 1);
  }
});

test("frozen accessors and objects with mutable internal slots remain copied", () => {
  let key = 1;
  const accessor = Object.freeze({
    get key() {
      return key;
    },
  });
  const snapshot = createDirectPoseEvidenceSnapshots();
  const first = snapshot(accessor);
  key = 2;
  expect(snapshot(accessor)).toEqual({ key: 2 });
  expect(first).toEqual({ key: 1 });
  const map = Object.freeze(new Map([["key", 1]]));
  const evidence = Object.freeze({ map });
  const saved = snapshot(evidence);
  map.set("key", 2);
  expect(snapshot(evidence).map.get("key")).toBe(2);
  expect(saved.map.get("key")).toBe(1);
});

test("immutable cyclic observations preserve clone semantics and reuse", () => {
  const evidence = {};
  evidence.self = evidence;
  Object.freeze(evidence);
  const snapshot = createDirectPoseEvidenceSnapshots();
  const first = snapshot(evidence);
  expect(first.self).toBe(first);
  expect(first).not.toBe(evidence);
  expect(snapshot(evidence)).toBe(first);
  expect(Object.isFrozen(first)).toBe(true);
});

test("different immutable source-target compositions share one owned snapshot of each observation", () => {
  const source = Object.freeze({
    cursor: Object.freeze({ transportSequence: 3, entryOrder: 4 }),
    time: -0,
  });
  const a = Object.freeze({ source, target: null }),
    b = Object.freeze({ source, target: source });
  const snapshot = createDirectPoseEvidenceSnapshots(),
    first = snapshot(a),
    second = snapshot(b);
  expect(first).toEqual(structuredClone(a));
  expect(second).toEqual(structuredClone(b));
  expect(first.source).toBe(second.source);
  expect(second.source).toBe(second.target);
  expect(first.source).not.toBe(source);
  expect(Object.is(first.source.time, -0)).toBe(true);
});
