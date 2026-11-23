import { expect, test } from "bun:test";
import {
  NATIVE_CLIP_MAP_POLICY as policy,
  resolveNativeClipMap,
} from "./native-clip-map-policy.mjs";
const hash = "a".repeat(64),
  ownerPath = "12345678";
const entry = (key, classHash) => ({
  key: { type: "Hash", value: key },
  value: { type: "Struct", classHash, fields: {} },
});
function fixture() {
  // Native tie order intentionally differs from source order.
  const entries = [
    entry(9, "11111111"),
    entry(2, "33333333"),
    entry(9, "22222222"),
  ];
  const nativeRows = [
    { index: 0, key: 2, classHash: "33333333" },
    { index: 1, key: 9, classHash: "22222222" },
    { index: 2, key: 9, classHash: "11111111" },
  ];
  const observation = {
    schema: 1,
    kind: "original-duplicate-bin-map-observations",
    build: policy.build,
    protocol: policy.protocol,
    decoderImageSha256: policy.decoderImageSha256,
    sourceBinSha256: hash,
    inputSha256: hash,
    boundary: null,
    scope: { originalTypedReaderExecuted: true, animationGraphPrepared: false },
    sources: { reader: hash },
    originalBlocks: policy.sourceBlocks,
    cases: [
      {
        ownerPath,
        trail: [],
        classHash: policy.classHash,
        fieldHash: policy.fieldHash,
        originalEntries: 3,
        nativeRows,
        nativeDuplicateRows: nativeRows.slice(1),
        lookupConsumerExecuted: true,
        lookup: {
          constructionPrefix: policy.constructionPrefix,
          queryCallsite: policy.queryCallsite,
          queryHelperRva: policy.queryHelperRva,
          existingCacheUnchanged: true,
          fullGraphPreparationExecuted: false,
          selectedIndex: 2,
          selectedClassHash: "11111111",
          cacheEntries: 2,
        },
      },
    ],
  };
  const resolve = () =>
    resolveNativeClipMap({
      entries,
      sourceBinSha256: hash,
      ownerPath,
      observationBytes: new TextEncoder().encode(JSON.stringify(observation)),
    });
  return { entries, observation, resolve };
}
test("native graph lookup preserves source declarations and selects last native row rather than source order", () => {
  const f = fixture(),
    result = f.resolve();
  expect(
    result.selectedEntries.map((x) => [x.key, x.sourceIndex, x.nativeIndex]),
  ).toEqual([
    [2, 1, 0],
    [9, 0, 2],
  ]);
  expect(result.originalEntries).toBe(f.entries);
  expect(result.selectedEntries[1].value).toBe(f.entries[0].value);
  expect(result.scope.fullGraphPreparation).toBe(false);
});
test("unknown build/property, incomplete consumer proof and modified native instructions reject", () => {
  for (const mutate of [
    (f) => (f.observation.build = "16.22.834.8910"),
    (f) => (f.observation.cases[0].fieldHash = "f598463e"),
    (f) => (f.observation.cases[0].lookupConsumerExecuted = false),
    (f) => (f.observation.boundary = { kind: "unmapped" }),
    (f) => (f.observation.originalBlocks = []),
    (f) => (f.observation.sourceBinSha256 = "b".repeat(64)),
  ]) {
    const f = fixture();
    mutate(f);
    expect(f.resolve).toThrow();
  }
});
test("native multiset/order and contradictory winner reject", () => {
  for (const mutate of [
    (f) => (f.observation.cases[0].nativeRows[1].key = 1),
    (f) => (f.observation.cases[0].nativeRows[1].classHash = "aaaaaaaa"),
    (f) => (f.observation.cases[0].lookup.selectedIndex = 1),
    (f) => (f.observation.cases[0].lookup.cacheEntries = 3),
  ]) {
    const f = fixture();
    mutate(f);
    expect(f.resolve).toThrow();
  }
});
test("same-class source identity ambiguity remains explicitly unsupported", () => {
  const f = fixture();
  f.entries[2].value.classHash = "11111111";
  f.observation.cases[0].nativeRows[1].classHash = "11111111";
  expect(f.resolve).toThrow("ambiguous same-class");
});
