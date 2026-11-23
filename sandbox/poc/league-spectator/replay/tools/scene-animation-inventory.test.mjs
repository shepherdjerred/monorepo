import { expect, test } from "bun:test";
import { compileSceneEventInventory } from "./scene-animation-inventory.mjs";
test("hashed native event fields retain every distinct row and unsupported class", () => {
  const table = {
    "{2c868943}@native-row-3": { __type: "{bcf56e70}", value: 1 },
    "{2c868943}@native-row-4": { __type: "{77c7801e}", value: 2 },
  };
  const result = compileSceneEventInventory([
    {
      file: "galio/graph.json",
      sha256: "a".repeat(64),
      nativeMapEvidence: { file: "galio/proof.json", sha256: "b".repeat(64) },
      value: { root: { __type: "AtomicClipData", "{f598463e}": table } },
    },
  ]);
  expect(result.maps[0].entries.map((row) => row.id)).toEqual(
    Object.keys(table),
  );
  expect(result.maps[0].entries.map((row) => row.value.__type)).toEqual([
    "{bcf56e70}",
    "{77c7801e}",
  ]);
  expect(result.nodeClasses).toContain("{bcf56e70}");
  expect(result.maps[0].schedulingAdmitted).toBe(false);
  expect(result.capabilities.effectBindingsAdmitted).toBe(false);
});
test("unresolved original duplicate maps retain source row identity without claiming native order", () => {
  const value = {
    __type: "UnresolvedOriginalBinMap",
    entries: [0, 1].map((sourceEntry) => ({
      sourceEntry,
      key: "same",
      value: { __type: "ParticleEventData" },
    })),
  };
  const result = compileSceneEventInventory([
    {
      file: "graph.json",
      sha256: "a".repeat(64),
      value: { root: { __type: "AtomicClipData", mEventDataMap: value } },
    },
  ]);
  expect(result.maps[0].entries.map((row) => row.id)).toEqual([
    "same@source-row-0",
    "same@source-row-1",
  ]);
  expect(result.maps[0].nativeOrder).toBe("unresolved-original-map");
});
