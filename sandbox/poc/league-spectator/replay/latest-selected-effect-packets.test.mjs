import { expect, test } from "bun:test";
import {
  assertEffectPacketSceneRebinding,
  assertLatestSelectedEffectPacket,
} from "./latest-selected-effect-packets.mjs";
const oldHash = "a".repeat(64),
  newHash = "b".repeat(64);
const scene = {
  map: {
    id: 12,
    variant: "base",
    min: [0, 0],
    max: [100, 100],
    movementOrigin: [50, 50],
  },
};
const fixture = () => ({
  sceneManifestSha256: oldHash,
  mapId: 12,
  mapVariant: "base",
  mapMin: [0, 0],
  mapMax: [100, 100],
  origin: [50, 50],
  fields: { x: { offset: 4, decode: [[0, 1]] } },
  prefixBlock: [1, 2],
  sourceBlocks: [{ sha256: "c".repeat(64) }],
  creationPackageSha256: "d".repeat(64),
  scalar: -0,
});

test("scene-only packet rebinding preserves native codecs, calls and signed numeric data", () => {
  for (const kind of ["placement", "descriptor"]) {
    const reference = fixture(),
      selected = {
        ...structuredClone(reference),
        sceneManifestSha256: newHash,
      };
    assertEffectPacketSceneRebinding(kind, reference, selected, scene, newHash);
    expect(reference.sceneManifestSha256).toBe(oldHash);
    for (const edit of [
      (v) => v.fields.x.offset++,
      (v) => v.fields.x.decode[0][0]++,
      (v) => v.prefixBlock[1]++,
      (v) => (v.scalar = 0),
      (v) => (v.sourceBlocks = []),
      (v) => (v.creationPackageSha256 = "e".repeat(64)),
      (v) => (v.extra = true),
    ]) {
      const bad = structuredClone(selected);
      edit(bad);
      expect(() =>
        assertEffectPacketSceneRebinding(kind, reference, bad, scene, newHash),
      ).toThrow("only its exact scene parent");
    }
  }
});
test("another map or changed quantization domain needs its own native proof", () => {
  const reference = fixture(),
    selected = { ...structuredClone(reference), sceneManifestSha256: newHash };
  for (const edit of [
    (s) => (s.map.id = 11),
    (s) => (s.map.variant = "other"),
    (s) => s.map.min[0]++,
    (s) => s.map.max[1]++,
    (s) => s.map.movementOrigin[0]++,
  ]) {
    const bad = structuredClone(scene);
    edit(bad);
    expect(() =>
      assertEffectPacketSceneRebinding(
        "placement",
        reference,
        selected,
        bad,
        newHash,
      ),
    ).toThrow("original map quantization");
  }
});
test("unknown programs, stale scene identity and forged selection cannot authorize packet codecs", async () => {
  expect(() =>
    assertEffectPacketSceneRebinding(
      "new",
      fixture(),
      fixture(),
      scene,
      oldHash,
    ),
  ).toThrow("Known original");
  expect(() =>
    assertEffectPacketSceneRebinding(
      "descriptor",
      fixture(),
      fixture(),
      scene,
      newHash,
    ),
  ).toThrow("only its exact");
  await expect(
    assertLatestSelectedEffectPacket({ selection: {}, kind: "placement" }),
  ).rejects.toThrow("Owned selected");
});
