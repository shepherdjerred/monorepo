import { expect, test } from "bun:test";
import {
  createSceneAllVisionFog,
  isSceneAllVisionFog,
} from "./scene-all-vision-fog.mjs";
import { prepareNativeParticleGpuBinding } from "./latest-native-particle-gpu-binding.mjs";
import { resolveSceneColdMaterialBindings } from "./scene-cold-material-bindings.mjs";
test("all-vision publication requires an explicit perspective before acquiring any bytes", async () => {
  for (const perspective of [undefined, null, "blue", "red", "ALL", 0]) {
    let reads = 0;
    await expect(
      createSceneAllVisionFog({
        perspective,
        readResource: () => {
          reads++;
          throw Error("read");
        },
      }),
    ).rejects.toThrow("Explicit supported all-vision");
    expect(reads).toBe(0);
  }
});
test("JSON-shaped authority clones cannot add uniforms or texture capabilities", async () => {
  const forged = {
    describe: () => ({ perspective: "all" }),
    uniform: () => ({ name: "FOG_OF_WAR_PARAMS", bytesHex: "00" }),
    binding: () => ({ kind: "original-all-vision-fog-texture" }),
  };
  expect(isSceneAllVisionFog(forged)).toBe(false);
  await expect(
    prepareNativeParticleGpuBinding(null, null, { allVisionFog: forged }),
  ).rejects.toThrow("Owned original all-vision");
  expect(() =>
    resolveSceneColdMaterialBindings(
      { textures: { fow: forged.binding() } },
      null,
      { allVisionFog: forged },
    ),
  ).toThrow("Unowned original all-vision");
});
test("legacy controlled-texture resolution rejects an unowned fog binding", () => {
  expect(() =>
    resolveSceneColdMaterialBindings(
      {
        textures: {
          fow: { kind: "original-all-vision-fog-texture", perspective: "all" },
        },
      },
      null,
    ),
  ).toThrow("Unowned original all-vision");
  expect(
    resolveSceneColdMaterialBindings(
      { textures: { base: { kind: "prepared-texture", file: "source.png" } } },
      null,
    ),
  ).toEqual({
    binding: {
      textures: { base: { kind: "prepared-texture", file: "source.png" } },
    },
  });
});
