import { expect, test } from "bun:test";
import { normalizeProvedNativeActorMap } from "./native-actor-map-bridge.mjs";
import { NATIVE_CLIP_MAP_POLICY } from "./native-clip-map-policy.mjs";
import { NATIVE_EVENT_MAP_POLICY } from "./native-event-map-policy.mjs";
function fixture(kind) {
  const policy =
    kind === "clip" ? NATIVE_CLIP_MAP_POLICY : NATIVE_EVENT_MAP_POLICY;
  const digest = "a".repeat(64),
    ownerPath = "12345678";
  const entries = ["11111111", "22222222"].map((classHash) => ({
    key: { type: "Hash", value: 7 },
    value: { type: "Struct", classHash, fields: {} },
  }));
  const nativeRows = entries.map((entry, index) => ({
    index,
    key: 7,
    classHash: entry.value.classHash,
  }));
  const observed = {
    ownerPath,
    trail: [],
    classHash: policy.classHash,
    fieldHash: policy.fieldHash,
    originalEntries: 2,
    nativeRows,
    nativeDuplicateRows: nativeRows,
  };
  if (kind === "clip")
    Object.assign(observed, {
      lookupConsumerExecuted: true,
      lookup: {
        constructionPrefix: policy.constructionPrefix,
        queryCallsite: policy.queryCallsite,
        queryHelperRva: policy.queryHelperRva,
        cacheEntries: 1,
        selectedIndex: 1,
        selectedClassHash: "22222222",
        existingCacheUnchanged: true,
        fullGraphPreparationExecuted: false,
      },
    });
  else
    observed.eventPreparation = {
      originalMethodRva: policy.originalMethodRva,
      iterationBlock: policy.iterationBlock,
      originalCallbacksExecuted: true,
      context: "original-empty-graph-constructor",
      animationResourceLookupExecuted: false,
      eventSchedulingExecuted: false,
      fullGraphPreparationExecuted: false,
      calls: nativeRows.map((row) => ({ ...row, callbackRva: 123 })),
    };
  const observation = {
    schema: 1,
    kind: "original-duplicate-bin-map-observations",
    build: policy.build,
    protocol: policy.protocol,
    decoderImageSha256: policy.decoderImageSha256,
    sourceBinSha256: digest,
    inputSha256: digest,
    boundary: null,
    scope: { originalTypedReaderExecuted: true, animationGraphPrepared: false },
    originalBlocks: policy.sourceBlocks,
    sources: { observer: digest },
    cases: [observed],
  };
  const opaque = {
    __type: "UnresolvedOriginalBinMap",
    reason: "duplicate-original-map-keys",
    original: { type: "Map", entries },
    entries: entries.map((entry, sourceEntry) => ({
      key: "{00000007}",
      value: { __type: entry.value.classHash },
      sourceEntry,
    })),
  };
  const options = {
    kind,
    opaque,
    sourceBinSha256: digest,
    ownerPath,
    observationBytes: new TextEncoder().encode(JSON.stringify(observation)),
  };
  return { opaque, options };
}
test("proved clip normalization exposes the actual winner and retains both original declarations", () => {
  const { opaque, options } = fixture("clip"),
    before = structuredClone(opaque),
    out = normalizeProvedNativeActorMap(options);
  expect(out.value).toEqual({ "{00000007}": opaque.entries[1].value });
  expect(out.declaration.originalNormalizedEntries).toBe(opaque.entries);
  expect(out.declaration.rows[0].originalKeyHash).toBe(7);
  expect(opaque).toEqual(before);
});
test("proved event normalization keeps distinct internal row identities and the same authored key", () => {
  const { opaque, options } = fixture("event"),
    out = normalizeProvedNativeActorMap(options);
  expect(Object.keys(out.value)).toEqual([
    "{00000007}@native-row-0",
    "{00000007}@native-row-1",
  ]);
  expect(out.declaration.rows.map((row) => row.originalKey)).toEqual([
    "{00000007}",
    "{00000007}",
  ]);
  expect(out.declaration.eventSchedulingAdmitted).toBe(false);
  expect(out.declaration.original).toBe(opaque.original);
});
test("incomplete normalized declarations and unknown consumer policies remain unsupported", () => {
  for (const mutate of [
    (o) => (o.kind = "unknown"),
    (o) => (o.opaque.entries[1].sourceEntry = 0),
    (o) => (o.opaque.reason = "complex-original-map-keys"),
  ]) {
    const { options } = fixture("clip");
    mutate(options);
    expect(() => normalizeProvedNativeActorMap(options)).toThrow();
  }
});
