import { expect, test } from "bun:test";
import { createActorNativeMapNormalizer } from "./archived-actor-native-maps.mjs";
const hash = "a".repeat(64),
  context = {
    sourceBinSha256: hash,
    ownerPath: "12345678",
    trail: [],
    classHash: "f5fb07c7",
    fieldHash: "45e122f8",
  };
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value));
function opaque() {
  const entries = [0, 1].map((sourceEntry) => ({
    key: "{00000001}",
    value: { __type: "AtomicClipData" },
    sourceEntry,
  }));
  return {
    __type: "UnresolvedOriginalBinMap",
    reason: "duplicate-original-map-keys",
    entries,
    original: {
      type: "Map",
      entries: entries.map(() => ({
        key: { type: "Hash", value: 1 },
        value: { type: "Struct", classHash: "5bd9a1e6", fields: {} },
      })),
    },
  };
}
test("absent or unrelated observations preserve the complete opaque map", () => {
  const value = opaque(),
    before = JSON.stringify(value),
    declarations = [];
  expect(
    createActorNativeMapNormalizer([], declarations)(value, context),
  ).toBeUndefined();
  const unrelated = { sourceBinSha256: "b".repeat(64), cases: [context] };
  expect(
    createActorNativeMapNormalizer([bytes(unrelated)], declarations)(
      value,
      context,
    ),
  ).toBeUndefined();
  expect(
    createActorNativeMapNormalizer([], declarations)(value, {
      ...context,
      fieldHash: "00000000",
    }),
  ).toBeUndefined();
  expect(JSON.stringify(value)).toBe(before);
  expect(declarations).toEqual([]);
});
test("matching observations must pass the original native policy and cannot be ambiguous", () => {
  const proof = { sourceBinSha256: hash, cases: [context] };
  expect(() =>
    createActorNativeMapNormalizer([bytes(proof)], [])(opaque(), context),
  ).toThrow("Unsupported original clip-map proof boundary");
  expect(() =>
    createActorNativeMapNormalizer([bytes(proof), bytes(proof)], [])(
      opaque(),
      context,
    ),
  ).toThrow("Ambiguous");
});
