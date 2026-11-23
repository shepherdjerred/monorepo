import { expect, test } from "bun:test";
import {
  NATIVE_EVENT_MAP_POLICY as policy,
  retainNativeEventMap,
} from "./native-event-map-policy.mjs";
function fixture() {
  const hash = "a".repeat(64),
    ownerPath = "12345678";
  const entries = [
    { key: { type: "Hash", value: 7 }, value: { classHash: "11111111" } },
    { key: { type: "Hash", value: 7 }, value: { classHash: "22222222" } },
  ];
  const nativeRows = entries.map((entry, index) => ({
    index,
    key: entry.key.value,
    classHash: entry.value.classHash,
  }));
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
    sources: { observer: hash },
    originalBlocks: policy.sourceBlocks,
    cases: [
      {
        ownerPath,
        trail: [],
        classHash: policy.classHash,
        fieldHash: policy.fieldHash,
        originalEntries: 2,
        nativeRows,
        eventPreparation: {
          originalMethodRva: policy.originalMethodRva,
          iterationBlock: policy.iterationBlock,
          originalCallbacksExecuted: true,
          context: "original-empty-graph-constructor",
          animationResourceLookupExecuted: false,
          eventSchedulingExecuted: false,
          fullGraphPreparationExecuted: false,
          calls: nativeRows.map((row) => ({ ...row, callbackRva: 123 })),
        },
      },
    ],
  };
  return {
    entries,
    observation,
    resolve: () =>
      retainNativeEventMap({
        entries,
        sourceBinSha256: hash,
        ownerPath,
        observationBytes: new TextEncoder().encode(JSON.stringify(observation)),
      }),
  };
}
test("Atomic event preparation preserves both original callbacks sharing one authored key", () => {
  const f = fixture(),
    out = f.resolve();
  expect(out.eventEntries.map((row) => [row.key, row.sourceIndex])).toEqual([
    [7, 0],
    [7, 1],
  ]);
  expect(out.originalEntries).toBe(f.entries);
  expect(out.scope.eventScheduling).toBe(false);
});
test("missing, duplicated or altered native callback observations reject", () => {
  for (const mutate of [
    (f) => f.observation.cases[0].eventPreparation.calls.pop(),
    (f) => (f.observation.cases[0].eventPreparation.calls[1].index = 0),
    (f) =>
      (f.observation.cases[0].eventPreparation.originalCallbacksExecuted = false),
    (f) =>
      (f.observation.cases[0].eventPreparation.eventSchedulingExecuted = true),
    (f) => (f.observation.originalBlocks = []),
    (f) => (f.observation.build = "16.22.834.8910"),
    (f) => (f.observation.cases[0].fieldHash = "45e122f8"),
    (f) => (f.entries[1].value.classHash = "11111111"),
  ]) {
    const f = fixture();
    mutate(f);
    expect(f.resolve).toThrow();
  }
});
