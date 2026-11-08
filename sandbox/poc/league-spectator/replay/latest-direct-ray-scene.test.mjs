import { expect, test } from "bun:test";
import {
  directRayScene,
  DIRECT_RAY_SCENE_RESOURCES,
  DIRECT_RAY_SCENE_POLICY,
} from "./latest-direct-ray-scene.mjs";
import { sha256 } from "./structural-comparison.mjs";
const camera = {
  projectionRows: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  position: [3, 4, 5],
};
test("Ray scene binds constructor white/remap bytes under an explicit presentation policy", async () => {
  const s = directRayScene(camera),
    t = s.textures;
  expect(await sha256(t.FOW_MAP_SharedTexture.rgba)).toBe(
    DIRECT_RAY_SCENE_RESOURCES.whiteSha256,
  );
  expect(await sha256(t.PIXEL_COLOR_REMAP_RAMP_SharedTexture.rgba)).toBe(
    DIRECT_RAY_SCENE_RESOURCES.transparentSha256,
  );
  expect(t.FOW_MAP_SharedTexture.inputPolicy).toBe(DIRECT_RAY_SCENE_POLICY);
  expect(new Float32Array(s.uniforms.vCamera.buffer)).toEqual(
    new Float32Array([3, 4, 5, 0]),
  );
  expect(s.scope.nativeSceneRecovered).toBe(false);
  expect(s.scope.actualMatchVisibilityRecovered).toBe(false);
  s.textures.FOW_MAP_SharedTexture.rgba[0] = 0;
  expect(directRayScene(camera).textures.FOW_MAP_SharedTexture.rgba[0]).toBe(
    255,
  );
});
test("Ray scene rejects incomplete or nonfinite explicit camera inputs", () => {
  for (const value of [
    { ...camera, projectionRows: [1] },
    { ...camera, position: [1, NaN, 3] },
    { ...camera, position: undefined },
  ])
    expect(() => directRayScene(value)).toThrow("Explicit finite");
});
