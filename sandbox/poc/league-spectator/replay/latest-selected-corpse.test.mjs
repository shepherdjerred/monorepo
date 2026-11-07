import { expect, test } from "bun:test";
import {
  assertCorpseSceneRebinding,
  assertLatestSelectedCorpse,
} from "./latest-selected-corpse.mjs";
import {
  createLatestCorpsePolicy,
  createLatestMinionCorpsePlayback,
  CORPSE_POLICY_SHA,
} from "./latest-corpse.mjs";
const source = () => ({
  sceneManifestSha256: "a".repeat(64),
  worldCatalogSha256: "c".repeat(64),
  assets: { minion: { lifetime: -0 } },
  sourceBlocks: [{ startRva: 1, endRva: 2, sha256: "d".repeat(64) }],
  deathModes: [false, true],
});
test("corpse scene-only rebinding retains exact data including signed zero", () => {
  const reference = source(),
    selected = {
      ...structuredClone(reference),
      sceneManifestSha256: "b".repeat(64),
    };
  assertCorpseSceneRebinding(reference, selected, "b".repeat(64));
  for (const edit of [
    (s) => (s.worldCatalogSha256 = "e".repeat(64)),
    (s) => (s.assets.minion.lifetime = 0),
    (s) => (s.deathModes[0] = true),
    (s) => (s.sourceBlocks[0].endRva = 3),
    (s) => (s.extra = true),
  ]) {
    const changed = structuredClone(selected);
    edit(changed);
    expect(() =>
      assertCorpseSceneRebinding(reference, changed, "b".repeat(64)),
    ).toThrow("may rebind only");
  }
  expect(() =>
    assertCorpseSceneRebinding(reference, selected, "bad"),
  ).toThrow();
  expect(() =>
    assertCorpseSceneRebinding(reference, selected, "a".repeat(64)),
  ).toThrow();
});
test("corpse selected capability rejects lookalike ownership and accessors before use", async () => {
  await expect(
    assertLatestSelectedCorpse({ selection: { assertRole() {} } }),
  ).rejects.toThrow("Owned selected static catalog required");
  let called = false;
  const selected = source();
  Object.defineProperty(selected, "assets", {
    enumerable: true,
    get() {
      called = true;
      return {};
    },
  });
  expect(() =>
    assertCorpseSceneRebinding(source(), selected, "b".repeat(64)),
  ).toThrow("Own data");
  expect(called).toBe(false);
});

test("legacy factory retains original native duration, clock and death-mode observations", async () => {
  const root = ".cache/replay-spike",
    profile = await Bun.file(
      `${root}/public/decoder-16.21-macos/profile.json`,
    ).json(),
    scene = await Bun.file(`${root}/public/latest-scene/manifest.json`).bytes(),
    world = await Bun.file(`${root}/public/latest-scene/world.json`).bytes(),
    bytes = await Bun.file(`${root}/public/latest-corpse/package.json`).bytes(),
    native = await Bun.file(
      `${root}/research/corpse-policy-native.json`,
    ).json(),
    policy = await createLatestCorpsePolicy(profile, scene, world, bytes);
  expect(policy.packageSha256).toBe(CORPSE_POLICY_SHA);
  expect(native.packageSha256).toBe(CORPSE_POLICY_SHA);
  expect(Object.isFrozen(policy)).toBe(true);
  expect(Object.isFrozen(policy.metadata.unitDeathMode.setsDeadFlag)).toBe(
    true,
  );
  expect(() => createLatestMinionCorpsePlayback({}, { ...policy }, {})).toThrow(
    "Corpse policy and replay differ",
  );
  for (const row of native.durationProbes)
    expect(policy.duration(row.deathTime)).toBe(row.duration);
  for (const row of native.clockProbes)
    expect(
      policy.retainsTicks(row.dead, row.ticks, row.deathTime).retained,
    ).toBe(row.retained);
  for (const row of native.deathModeProbes)
    expect(policy.modeFromRaw(row.raw)).toBe(row.setsDeadFlag);
});
