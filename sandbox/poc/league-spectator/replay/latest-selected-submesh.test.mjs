import { test, expect } from "bun:test";
import {
  assertLatestSelectedSubmesh,
  assertSelectedSubmeshProgram,
  deriveSelectedSubmeshAsset,
} from "./latest-selected-submesh.mjs";
const reference = () => ({
  schema: 1,
  sceneManifestSha256: "a".repeat(64),
  assets: {},
  fieldLayout: { start: 12 },
  defaultDataHex: "0000",
  sourceBlocks: [{ startRva: 1, endRva: 2, sha256: "c".repeat(64) }],
  scope: { nativeSchedulerExecuted: true },
});
test("submesh selected data can vary actors without changing its original algorithm", () => {
  const old = reference(),
    data = {
      ...structuredClone(old),
      sceneManifestSha256: "b".repeat(64),
      assets: { graph: { names: ["body"] } },
    };
  assertSelectedSubmeshProgram(old, data, "b".repeat(64));
  for (const edit of [
    (value) => value.fieldLayout.start++,
    (value) => (value.defaultDataHex = "01"),
    (value) => (value.sourceBlocks[0].sha256 = "d".repeat(64)),
    (value) => (value.scope.nativeSchedulerExecuted = false),
    (value) => (value.extra = true),
  ]) {
    const changed = structuredClone(data);
    edit(changed);
    expect(() =>
      assertSelectedSubmeshProgram(old, changed, "b".repeat(64)),
    ).toThrow("fixed original");
  }
});
test("submesh caller labels do not mint selected ownership", async () => {
  await expect(
    assertLatestSelectedSubmesh({ selection: { assertRole() {} } }),
  ).rejects.toThrow("Owned selected static catalog required");
  let called = false;
  const data = reference();
  Object.defineProperty(data, "assets", {
    enumerable: true,
    get() {
      called = true;
      return {};
    },
  });
  expect(() =>
    assertSelectedSubmeshProgram(reference(), data, "b".repeat(64)),
  ).toThrow("Own data");
  expect(called).toBe(false);
});
test("complete actual secondary asset projection matches original observations", async () => {
  const root = ".cache/replay-lineup-5667809143/public/latest-scene",
    scene = await Bun.file(`${root}/manifest.json`).json(),
    metadata = await Bun.file(
      ".cache/replay-lineup-5667809143/public/latest-submesh-visibility/package.json",
    ).json(),
    asset = Object.values(scene.champions)[0],
    entry = metadata.assets[asset.animationGraph],
    bytes = async (path) => Bun.file(`${root}/${path}`).bytes(),
    model = await bytes(asset.model),
    graph = await bytes(asset.animationGraph),
    skn = await bytes(entry.skn);
  expect(
    await deriveSelectedSubmeshAsset(entry.actor, asset, model, graph, skn),
  ).toEqual(entry);
  const altered = JSON.parse(new TextDecoder().decode(graph)),
    data = Object.values(altered).find(
      (value) => value?.__type === "AnimationGraphData",
    ),
    clip = Object.values(data.mClipDataMap).find((value) =>
      Object.values(value.mEventDataMap ?? {}).some(
        (e) => e.__type === "SubmeshVisibilityEventData",
      ),
    ),
    event = Object.values(clip.mEventDataMap).find(
      (e) => e.__type === "SubmeshVisibilityEventData",
    );
  event.unknownVisibilityField = true;
  await expect(
    deriveSelectedSubmeshAsset(
      entry.actor,
      asset,
      model,
      new TextEncoder().encode(JSON.stringify(altered)),
      skn,
    ),
  ).rejects.toThrow("Unknown authored");
});
