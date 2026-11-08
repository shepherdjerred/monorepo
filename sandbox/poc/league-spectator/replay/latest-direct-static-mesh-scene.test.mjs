import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { sha256 } from "./structural-comparison.mjs";
import {
  directStaticMeshScene,
  DIRECT_STATIC_MESH_SCENE_RESOURCES,
} from "./latest-direct-static-mesh-scene.mjs";
const camera = () => ({
  projectionRows: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  position: [1, 2, 3],
  forward: [0, -1, 0],
  up: [0, 0, 1],
});
test("mesh allvision scene owns exact native default pixels while retaining explicit policy omissions", async () => {
  const input = camera(),
    a = directStaticMeshScene(input);
  expect(a.textures.FOW_MAP_SharedTexture.rgba).toEqual(
    new Uint8Array([255, 255, 255, 255]),
  );
  expect(a.textures.PIXEL_COLOR_REMAP_RAMP_SharedTexture.rgba).toEqual(
    new Uint8Array(4),
  );
  const proofBytes = await Bun.file(
    resolve(
      import.meta.dir,
      "../../../../.cache/replay-spike/research/direct-ground-fow-native.json",
    ),
  ).bytes();
  expect(await sha256(proofBytes)).toBe(
    DIRECT_STATIC_MESH_SCENE_RESOURCES.nativeProofSha256,
  );
  const proof = JSON.parse(new TextDecoder().decode(proofBytes));
  for (const [name, key, hash] of [
    [
      "FOW_MAP_SharedTexture",
      "offsetA0",
      DIRECT_STATIC_MESH_SCENE_RESOURCES.whiteSha256,
    ],
    [
      "PIXEL_COLOR_REMAP_RAMP_SharedTexture",
      "offsetA8",
      DIRECT_STATIC_MESH_SCENE_RESOURCES.transparentSha256,
    ],
  ]) {
    const resource = proof.defaultTextures[key].resource;
    expect(resource.gpuBytesVerified).toBe(true);
    expect([
      resource.width,
      resource.height,
      resource.layers,
      resource.mips,
    ]).toEqual([1, 1, 1, 1]);
    const pixels = Uint8Array.fromHex(resource.levelsHex[0][0]);
    expect(await sha256(pixels)).toBe(hash);
    expect(a.textures[name].rgba).toEqual(pixels);
    expect(a.textures[name].resourcePolicy.sourceSha256).toBe(
      resource.nativeSourceSha256,
    );
  }
  expect(a.scope.nativeAlwaysBelowSetterRecovered).toBe(false);
  expect(a.scope.actualMatchVisibilityRecovered).toBe(false);
  a.uniforms.mProj.fill(0);
  a.textures.FOW_MAP_SharedTexture.rgba.fill(0);
  expect(directStaticMeshScene(input).uniforms.mProj[2]).toBe(128);
  expect(input.projectionRows[0]).toBe(1);
});
test("mesh scene rejects unknown camera fields and non-finite float32 overflow", () => {
  for (const changes of [
    { position: [Infinity, 0, 0] },
    { projectionRows: [1] },
    { forward: [0, 0, 0] },
    { up: [0, 1e100, 1] },
  ])
    expect(() => directStaticMeshScene({ ...camera(), ...changes })).toThrow();
});
