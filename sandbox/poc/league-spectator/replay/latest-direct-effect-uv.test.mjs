import { expect, test } from "bun:test";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import {
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
} from "./latest-direct-effect-runtime.mjs";
import { DIRECT_GROUND_POLICY } from "./latest-direct-ground-contract.mjs";
import { directEmitterMaterialAdmission } from "./latest-direct-effect-package.mjs";
import {
  compileDirectQuadSprite,
  assertDirectQuadSpriteMaterial,
} from "./latest-direct-effect-sprite.mjs";
import {
  compileDirectParticlePalette,
  validateDirectParticlePaletteProgram,
  assertDirectParticlePaletteMaterial,
} from "./latest-direct-particle-palette.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { DIRECT_CAMERA_ZERO_MESH_FLAGS_POLICY } from "./latest-direct-effect-camera-mesh-flags.mjs";

const texture = {
  kind: "texture",
  status: "prepared",
  file: "textures/control.png",
  sha256: "a".repeat(64),
};
const base = { __type: "VfxEmitterDefinitionData", texture: "base.tex" };
const sprite = {
  ...base,
  primitive: { __type: "VfxPrimitiveArbitraryQuad" },
  isGroundLayer: 1,
  blendMode: 4,
  numFrames: 4,
  isRandomStartFrame: 1,
};
const palette = { ...base, particleColorTexture: "Palette.tex" };
async function compile(source, assets = {}) {
  const id = "generic/quad-uv",
    definitionBytes = new TextEncoder().encode(
      JSON.stringify({
        definition: {
          __type: "VfxSystemDefinitionData",
          complexEmitterDefinitionData: [source],
        },
      }),
    ),
    manifest = {
      build,
      protocol,
      definitions: { [id]: { sha256: await sha256(definitionBytes) } },
      assets: { "base.tex": texture, "palette.tex": texture, ...assets },
    };
  return compileLatestDirectEffect({
    id,
    definitionBytes,
    manifest,
    manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
    kernels: {
      birth: {
        sampleValue: (v, _t, fallback) => v?.constantValue ?? fallback,
        createRandom: () => ({ next: () => 0.5 }),
      },
      emission: { eligibility: () => ({ reasons: [] }) },
      samplers: { describe: () => ({ previewSupported: true }) },
    },
  });
}
const globals = {
  glslName: "Globals_vs",
  size: 32,
  bytesHex: "0000803f0000803f0000803f0000000000000000000000000000000000000000",
  sceneMembers: [],
};
function binding(emitter, isPalette) {
  const defines = isPalette
    ? [
        { name: "ALPHA_TEST", value: "1" },
        { name: "DISABLE_FOW", value: "1" },
      ]
    : [{ name: "ALPHA_TEST", value: "1" }];
  return {
    effectId: "generic/quad-uv",
    emitterIndex: 0,
    family: "quad",
    materialPolicy: isPalette ? undefined : DIRECT_GROUND_POLICY,
    environment: {
      pass: isPalette ? 0 : 5,
      featuresEnabled: true,
      resourceMask: 0,
      systemFogMode: isPalette ? 1 : 0,
      graphics34b: false,
      graphics29c: 0,
    },
    nativeDefines: defines,
    defines,
    shaders: {
      vertex: {
        sha256: isPalette
          ? "5b965c0c3637b1b8324051f9bf1bc4557c43f75d844a94fdd87a66bb3772af4d"
          : "924cda2a7adbe0a9b2e7c7fcd6fc459f08694dd55bb17fa73441d98dd2691afe",
      },
      pixel: {
        sha256: isPalette
          ? "66fb44fe736a476b8b3676a855f41b460d423c324423b46bcd6671eca07c8574"
          : "6c8919d2888115e1acf410b50631b4bf8b471a9412884e2c2507843c95a164b6",
      },
    },
    blocks: [
      structuredClone(globals),
      {
        glslName: "Globals_ps",
        size: 16,
        bytesHex: "a1a0a03c000000000000000000000000",
        sceneMembers: [],
      },
    ],
    nativeBlendFactors: isPalette ? [1, 1, 1, 1] : [6, 6, 1, 1],
    textures: {
      PARTICLE_COLOR_TEXTURE_TX: {
        kind: "prepared-texture",
        file: texture.file,
        sha256: texture.sha256,
        nativeSamplerHex: "0101010101",
        sampler: { name: "clamp", pixelated: false },
      },
    },
  };
}

test("compiler admits bounded frame/palette programs without admitting other fields", async () => {
  const s = (await compile(sprite)).emitters[0],
    p = (await compile(palette)).emitters[0],
    normal = (await compile(base)).emitters[0];
  expect(s.spriteProgram).toEqual(
    compileDirectQuadSprite(sprite, "arbitrary-quad"),
  );
  expect(s.paletteProgram).toBeNull();
  expect(p.paletteProgram).toEqual(
    compileDirectParticlePalette(
      { ...palette, blendMode: 0 },
      "camera-quad",
      false,
    ),
  );
  expect(p.paletteTexture).toEqual(texture);
  expect(p.source.particleColorTexture).toBe("Palette.tex");
  expect(normal.spriteProgram).toBeNull();
  expect(normal.paletteProgram).toBeNull();
  expect(normal.paletteTexture).toBeNull();
  for (const source of [
    { ...sprite, numFrames: 3 },
    { ...sprite, frameRate: 1 },
    { ...sprite, texDiv: [2, 2] },
    { ...sprite, isGroundLayer: 0 },
    { ...sprite, blendMode: 1 },
    { ...palette, blendMode: 1 },
    { ...palette, alphaRef: 0 },
    { ...palette, particleColorTexture: null },
    { ...palette, paletteDefinition: {} },
    { ...palette, meshRenderFlags: 1 },
    { ...palette, meshRenderFlags: false },
    { ...palette, meshRenderFlags: "0" },
    {
      ...palette,
      meshRenderFlags: 0,
      primitive: { __type: "VfxPrimitiveArbitraryQuad" },
    },
  ])
    expect((await compile(source)).emitters).toHaveLength(0);
  const explicitZero = await compile({ ...palette, meshRenderFlags: 0 });
  expect(explicitZero.emitters).toHaveLength(1);
  expect(explicitZero.emitters[0].source.meshRenderFlags).toBe(0);
  expect(explicitZero.emitters[0].meshRenderFlagsPolicy).toBe(
    DIRECT_CAMERA_ZERO_MESH_FLAGS_POLICY,
  );
  const missing = await compile(palette, {
    "palette.tex": { kind: "texture", status: "missing" },
  });
  expect(missing.unsupported[0].reasons).toContain("material:palette-texture");
});
test("default palette program rejects corrupt, missing and inherited metadata", () => {
  const source = { ...palette, blendMode: 0 },
    program = compileDirectParticlePalette(source, "camera-quad", false),
    emitter = {
      source,
      primitive: "camera-quad",
      groundLayer: false,
      paletteProgram: program,
      paletteTexture: texture,
    };
  expect(validateDirectParticlePaletteProgram(emitter)).toEqual(program);
  for (const paletteProgram of [
    undefined,
    null,
    {},
    Object.create(program),
    { ...program, typeX: 0 },
    { ...program, texture: "other.tex" },
    { ...program, coefficients: [1, 1, -0, 0] },
    { ...program, coefficients: [1, 1, 0] },
    { ...program, extra: 0 },
  ])
    expect(() =>
      validateDirectParticlePaletteProgram({ ...emitter, paletteProgram }),
    ).toThrow("Malformed compiled");
  const sparse = [1, 1, 0, 0];
  delete sparse[2];
  expect(() =>
    validateDirectParticlePaletteProgram({
      ...emitter,
      paletteProgram: { ...program, coefficients: sparse },
    }),
  ).toThrow();
  expect(() =>
    validateDirectParticlePaletteProgram({
      ...emitter,
      source: { ...source, particleColorTexture: undefined },
    }),
  ).toThrow();
  expect(() =>
    validateDirectParticlePaletteProgram({ ...emitter, source: {} }),
  ).toThrow("Unexpected compiled");
  for (const key of [
    "colorLookUpTypeX",
    "colorLookUpTypeY",
    "colorLookUpScales",
    "colorLookUpOffsets",
    "paletteDefinition",
  ])
    for (const value of [undefined, 0, 1, null, {}]) {
      const invalid = { ...source, [key]: value };
      expect(
        compileDirectParticlePalette(invalid, "camera-quad", false),
      ).toBeNull();
      expect(() =>
        validateDirectParticlePaletteProgram({ ...emitter, source: invalid }),
      ).toThrow("Malformed compiled");
    }
  for (const paletteTexture of [
    undefined,
    null,
    {},
    { ...texture, kind: "mesh" },
    { ...texture, sha256: "invalid" },
    { ...texture, file: "/absolute.png" },
    { ...texture, file: "../parent.png" },
  ])
    expect(() =>
      validateDirectParticlePaletteProgram({ ...emitter, paletteTexture }),
    ).toThrow("Malformed compiled");
});
test("material admission retains exact native sprite divisions and palette resources", async () => {
  const s = (await compile(sprite)).emitters[0],
    p = (await compile(palette)).emitters[0],
    sb = binding(s, false),
    pb = binding(p, true);
  expect(() => assertDirectQuadSpriteMaterial(s, sb)).not.toThrow();
  expect(() => assertDirectParticlePaletteMaterial(p, pb)).not.toThrow();
  expect(
    directEmitterMaterialAdmission(s, new Map(), new Map()).reasons,
  ).toEqual(["material:native-ground-pass5-binding-unprepared"]);
  expect(
    directEmitterMaterialAdmission(p, new Map(), new Map()).reasons,
  ).toEqual(["material:translated-shader-binding"]);
  for (const mutate of [
    (b) => (b.environment.pass = 0),
    (b) => (b.environment.systemFogMode = 1),
    (b) => (b.nativeDefines = []),
    (b) => (b.shaders.vertex.sha256 = "0".repeat(64)),
    (b) => (b.blocks[0].bytesHex = "0".repeat(64)),
    (b) => (b.blocks[1].bytesHex = "0".repeat(32)),
    (b) => (b.nativeBlendFactors = [1, 1, 1, 1]),
  ]) {
    const b = structuredClone(sb);
    mutate(b);
    expect(() => assertDirectQuadSpriteMaterial(s, b)).toThrow("Exact native");
  }
  for (const mutate of [
    (b) => (b.environment.systemFogMode = 0),
    (b) => (b.nativeDefines = [b.nativeDefines[0], b.nativeDefines[0]]),
    (b) => (b.shaders.pixel.sha256 = "0".repeat(64)),
    (b) =>
      (b.textures.PARTICLE_COLOR_TEXTURE_TX.kind = "supplied-white-lookup"),
    (b) => (b.textures.PARTICLE_COLOR_TEXTURE_TX.sha256 = "b".repeat(64)),
    (b) =>
      (b.textures.PARTICLE_COLOR_TEXTURE_TX.nativeSamplerHex = "0000000101"),
    (b) => (b.textures.PARTICLE_COLOR_TEXTURE_TX.sampler.name = "repeat"),
    (b) => (b.blocks[0].bytesHex = "0".repeat(64)),
    (b) => (b.blocks[1].bytesHex = "0".repeat(32)),
  ]) {
    const b = structuredClone(pb);
    mutate(b);
    expect(() => assertDirectParticlePaletteMaterial(p, b)).toThrow(
      "Exact native",
    );
  }
});
