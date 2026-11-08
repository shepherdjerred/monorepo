import { expect, test } from "bun:test";
import {
  DIRECT_NAV_CAMERA_PACKAGE_SHA,
  DIRECT_NAV_CAMERA_POLICY,
  DIRECT_NAV_GROUND_PACKAGE_SHA,
  DIRECT_NAV_GROUND_POLICY,
  validateDirectNavGroundProgram,
} from "./latest-direct-nav-ground-materials.mjs";
import { DIRECT_NAV_SCENE_POLICY } from "./latest-direct-nav-scene-contract.mjs";
import { compileDirectDepthBiasProgram } from "./latest-direct-effect-depth-bias.mjs";

function camera() {
  const source = {
    isGroundLayer: 1,
    useNavmeshMask: 1,
    blendMode: 4,
    depthBiasFactors: [-1, -12],
  };
  return {
    index: 7,
    primitive: "camera-quad",
    groundLayer: true,
    source,
    blend: 4,
    materialKey: "control:7",
    materialPolicy: DIRECT_NAV_CAMERA_POLICY,
    multUvProgram: null,
    depthBiasProgram: compileDirectDepthBiasProgram(source, "camera-quad"),
    navGroundProgram: {
      schema: 1,
      policy: DIRECT_NAV_CAMERA_POLICY,
      packageSha256: DIRECT_NAV_CAMERA_PACKAGE_SHA,
      scenePolicy: DIRECT_NAV_SCENE_POLICY,
      effectId: "control",
      emitterIndex: 7,
      sourceDefinitionSha256: "a".repeat(64),
      passHash: 1047222492,
      variantIndex: 0,
      shaderPair: {
        vertex:
          "5fe789950f7002b7fb8e36add0855f18c59bbd22bb835c6d0229b4e7e9de7d91",
        pixel:
          "02a925f204cf6c38ec27bc67d93f328f3e00e42bddc6511920bf1f87a6ea4e42",
      },
    },
  };
}
test("camera nav contract retains original pass5, exact shader pair and source raster factors", () => {
  for (const primitive of [undefined, { __type: "VfxPrimitiveCameraQuad" }]) {
    const e = camera();
    if (primitive) e.source.primitive = primitive;
    expect(validateDirectNavGroundProgram(e)).toEqual(e.navGroundProgram);
  }
  for (const change of [
    (e) => (e.primitive = "arbitrary-quad"),
    (e) => (e.source.primitive = { __type: "VfxPrimitiveArbitraryQuad" }),
    (e) => (e.navGroundProgram.passHash = 3867909202),
    (e) =>
      (e.navGroundProgram.shaderPair.pixel =
        "0111da660621998bf87e4e35d59eb3ddb19c38b2bdf79aace812fb13a407af19"),
    (e) => (e.navGroundProgram.packageSha256 = DIRECT_NAV_GROUND_PACKAGE_SHA),
    (e) => (e.materialPolicy = DIRECT_NAV_GROUND_POLICY),
    (e) => (e.depthBiasProgram.slope = 1),
    (e) => (e.source.depthBiasFactors = [-1, -60]),
  ]) {
    const e = structuredClone(camera());
    change(e);
    expect(() => validateDirectNavGroundProgram(e)).toThrow();
  }
});
test("original arbitrary pass5 policy cannot inherit the camera extension", () => {
  const e = camera();
  e.navGroundProgram.policy = DIRECT_NAV_GROUND_POLICY;
  e.navGroundProgram.packageSha256 = DIRECT_NAV_GROUND_PACKAGE_SHA;
  e.materialPolicy = DIRECT_NAV_GROUND_POLICY;
  expect(() => validateDirectNavGroundProgram(e)).toThrow();
});
