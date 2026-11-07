import { expect, test } from "bun:test";
import {
  assertWorldStateSceneRebinding,
  assertLatestSelectedWorldState,
} from "./latest-selected-world-state.mjs";
import { WORLD_STATE_SHA } from "./latest-world-state.mjs";
import { WORLD_STATE_SHA as APPROVED } from "./latest-world-state-contract.mjs";

const oldScene = "a".repeat(64),
  newScene = "b".repeat(64);
function fixture() {
  return {
    schema: 1,
    kind: "native-world-state-schema",
    sceneManifestSha256: oldScene,
    worldCatalogSha256: "c".repeat(64),
    mapId: 12,
    classes: { minion: { offsets: [0, 16], floatMask: 3 } },
    assets: { minion: { records: { base: { healthBarHeight: 100 } } } },
    sourceBlocks: [{ startRva: 1, endRva: 2, sha256: "d".repeat(64) }],
    defaults: { lane: -0 },
  };
}

test("world schema permits only an exact scene-parent rebinding", () => {
  const reference = fixture(),
    selected = { ...structuredClone(reference), sceneManifestSha256: newScene };
  assertWorldStateSceneRebinding(reference, selected, newScene);
  assertWorldStateSceneRebinding(
    reference,
    structuredClone(reference),
    oldScene,
  );
  expect(reference.sceneManifestSha256).toBe(oldScene);
  expect(selected.sceneManifestSha256).toBe(newScene);
  expect(WORLD_STATE_SHA).toBe(APPROVED);
});

test("new world classes, asset data and native proofs require independent admission", () => {
  const edits = [
    (data) => (data.worldCatalogSha256 = "e".repeat(64)),
    (data) => (data.mapId = 11),
    (data) => (data.classes.minion.offsets[1] = 20),
    (data) => (data.assets.minion.records.base.healthBarHeight = 101),
    (data) => (data.sourceBlocks[0].sha256 = "f".repeat(64)),
    (data) => (data.defaults.lane = 0),
    (data) => (data.extra = true),
    (data) => delete data.kind,
  ];
  for (const edit of edits) {
    const reference = fixture(),
      selected = {
        ...structuredClone(reference),
        sceneManifestSha256: newScene,
      };
    edit(selected);
    expect(() =>
      assertWorldStateSceneRebinding(reference, selected, newScene),
    ).toThrow("may rebind only");
  }
});

test("stale scene linkage and non-own input are rejected before getters run", () => {
  const reference = fixture();
  expect(() =>
    assertWorldStateSceneRebinding(reference, reference, newScene),
  ).toThrow("may rebind only");
  expect(() =>
    assertWorldStateSceneRebinding(reference, reference, "invalid"),
  ).toThrow("may rebind only");
  let called = false;
  const accessor = { ...reference };
  Object.defineProperty(accessor, "sceneManifestSha256", {
    enumerable: true,
    get() {
      called = true;
      return newScene;
    },
  });
  expect(() =>
    assertWorldStateSceneRebinding(reference, accessor, newScene),
  ).toThrow("Own data");
  expect(called).toBe(false);
});

test("a caller hash or lookalike selection cannot approve a world package", async () => {
  await expect(
    assertLatestSelectedWorldState({
      selection: { assertRole() {}, profile() {} },
      approvedReferenceSha256: "a".repeat(64),
    }),
  ).rejects.toThrow("Owned selected static catalog required");
});
