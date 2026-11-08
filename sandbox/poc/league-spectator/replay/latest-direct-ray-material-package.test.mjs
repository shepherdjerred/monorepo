import { expect, test } from "bun:test";
import {
  DIRECT_RAY_MATERIALS_SHA,
  DIRECT_RAY_MATERIAL_POLICY,
  DIRECT_RAY_SHADER_PAIR,
  validateDirectRayMaterialSelection,
  isLatestDirectRayMaterialPackage,
} from "./latest-direct-ray-material-package.mjs";
const owner = {
  id: "supplied-ray-contract",
  definitionHash: "a".repeat(64),
  index: 2,
};
function emitter() {
  return {
    primitive: "ray",
    materialKey: `${owner.id}:2`,
    materialPolicy: DIRECT_RAY_MATERIAL_POLICY,
    source: {
      blendMode: 1,
      texture: "base.tex",
      particleColorTexture: "palette.tex",
    },
    texture: {
      kind: "texture",
      status: "prepared",
      sourceSha256: "b".repeat(64),
    },
    rayPaletteTexture: {
      kind: "texture",
      status: "prepared",
      sourceSha256: "c".repeat(64),
    },
    rayMaterialSelection: {
      schema: 1,
      status: "owned-direct-ray-material-selection",
      policy: DIRECT_RAY_MATERIAL_POLICY,
      packageSha256: DIRECT_RAY_MATERIALS_SHA,
      effectId: owner.id,
      emitterIndex: 2,
      sourceDefinitionSha256: owner.definitionHash,
      primitiveVtableRva: 0x23f26e0,
      writerRva: 0x1734a30,
      vertexStride: 28,
      passHash: 2700020711,
      selectedPass: "post_distortion",
      variantIndex: 0,
      shaderPair: { ...DIRECT_RAY_SHADER_PAIR },
      textureDivisions: [4, 1],
      textures: [
        {
          name: "TEXTURE__TX",
          path: "base.tex",
          sourceSha256: "b".repeat(64),
          pixelSha256: "d".repeat(64),
          width: 256,
          height: 256,
          samplerDescriptorHex: "00000000000000000100010100000000",
        },
        {
          name: "PARTICLE_COLOR_TEXTURE__TX",
          path: "palette.tex",
          sourceSha256: "c".repeat(64),
          pixelSha256: "e".repeat(64),
          width: 8,
          height: 8,
          samplerDescriptorHex: "01010100000000000100010100000000",
        },
      ],
      pipeline: {
        descriptorHex:
          "3f0000000403000000000606070700010f000000000000000000000000000000",
        state: {
          blendEnabled: true,
          depthEnabled: false,
          stencilEnabled: false,
          cullEnabled: false,
          polygonOffsetEnabled: false,
          colorMask: [true, true, true, true],
          depthMask: false,
          depthFunction: 519,
          stencilFunction: 519,
          stencilOperations: [7680, 7680, 7680],
          stencilReadMask: 0xffffffff,
          stencilWriteMask: 0,
          blendFactors: [770, 771, 770, 771],
          blendOperations: [32774, 32774],
          cullFace: 1029,
          frontFace: 2304,
          polygonOffset: [0, 0],
        },
      },
      scope: {
        selectedResourcesGpuVerified: true,
        sceneInputsResolved: false,
        wholeRootGpuPrepared: false,
        nativeWorldAcceptance: null,
      },
    },
  };
}
test("serialized Ray selection retains exact owner, source resources and original pipeline", () => {
  const e = emitter();
  expect(validateDirectRayMaterialSelection(e, owner)).toBe(
    e.rayMaterialSelection,
  );
  const changes = [
    (e) => (e.materialKey = "foreign:2"),
    (e) => (e.materialPolicy = "other"),
    (e) => (e.rayMaterialSelection.effectId = "foreign"),
    (e) => (e.rayMaterialSelection.emitterIndex = 3),
    (e) => (e.rayMaterialSelection.packageSha256 = "f".repeat(64)),
    (e) => (e.rayMaterialSelection.shaderPair.pixel = "f".repeat(64)),
    (e) => (e.rayMaterialSelection.passHash = 0),
    (e) => (e.rayMaterialSelection.variantIndex = 1),
    (e) => (e.rayMaterialSelection.textureDivisions[0] = 1),
    (e) =>
      (e.rayMaterialSelection.textures[1].samplerDescriptorHex =
        "03030300000000000100010100000000"),
    (e) => (e.rayPaletteTexture.sourceSha256 = "f".repeat(64)),
    (e) => delete e.rayPaletteTexture,
    (e) => (e.source.blendMode = 0),
    (e) => (e.rayMaterialSelection.pipeline.state.depthFunction = 513),
    (e) => (e.rayMaterialSelection.pipeline.state.extra = true),
    (e) => (e.rayMaterialSelection.pipeline.state.blendFactors[1] = 1),
    (e) => (e.rayMaterialSelection.scope.sceneInputsResolved = true),
    (e) => (e.rayMaterialSelection.scope.nativeWorldAcceptance = true),
  ];
  for (const change of changes) {
    const v = emitter();
    change(v);
    expect(() => validateDirectRayMaterialSelection(v, owner)).toThrow();
  }
  expect(() =>
    validateDirectRayMaterialSelection({ ...e, primitive: "camera" }, owner),
  ).toThrow();
  expect(isLatestDirectRayMaterialPackage({ inspect() {} })).toBe(false);
});
