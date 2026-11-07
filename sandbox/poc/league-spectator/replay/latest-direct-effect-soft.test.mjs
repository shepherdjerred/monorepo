import { expect, test } from "bun:test";
import {
  compileDirectDepthDisabledSoftParticles,
  assertDirectDepthDisabledSoftMaterial,
  validateDirectDepthDisabledSoftProgram,
  DIRECT_SOFT_PARTICLE_POLICY,
  DIRECT_SOFT_PARTICLE_OMISSIONS,
} from "./latest-direct-effect-soft.mjs";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import {
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
} from "./latest-direct-effect-runtime.mjs";
import { sha256 } from "./structural-comparison.mjs";

const soft = () => ({ __type: "VfxSoftParticleDefinitionData", deltaIn: 100 });
const source = () => ({
  blendMode: 1,
  alphaRef: 0,
  softParticleParams: soft(),
});
async function compile(extra = {}) {
  const id = "generic/soft-material-control";
  const definitionBytes = new TextEncoder().encode(
    JSON.stringify({
      definition: {
        __type: "VfxSystemDefinitionData",
        complexEmitterDefinitionData: [
          {
            __type: "VfxEmitterDefinitionData",
            texture: "control.png",
            primitive: { __type: "VfxPrimitiveArbitraryQuad" },
            ...source(),
            ...extra,
          },
        ],
      },
    }),
  );
  const manifest = {
    build,
    protocol,
    definitions: { [id]: { sha256: await sha256(definitionBytes) } },
    assets: { "control.png": { kind: "texture", status: "prepared" } },
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
const binding = (emitter) => ({
  effectId: "generic/soft-material-control",
  emitterIndex: emitter.index,
  family: "quad",
  environment: {
    pass: 0,
    featuresEnabled: true,
    resourceMask: 0,
    systemFogMode: 1,
    graphics34b: false,
    graphics29c: 0,
  },
  nativeDefines: [{ name: "DISABLE_FOW", value: "1" }],
  defines: [{ name: "DISABLE_FOW", value: "1" }],
  shaders: {
    vertex: {
      sha256:
        "5b965c0c3637b1b8324051f9bf1bc4557c43f75d844a94fdd87a66bb3772af4d",
    },
    pixel: {
      sha256:
        "19de208150616d57c1f52e50f617a6cf41d378a168d6a574ce93320b356c56c8",
    },
  },
  textures: {
    PIXEL_COLOR_REMAP_RAMP_SharedTexture: {},
    TEXTURE_TX: {},
    PARTICLE_COLOR_TEXTURE_TX: {},
  },
  blocks: [{ sceneMembers: [] }],
});

test("soft material admission preserves authored inputs and explicitly omits depth behavior", async () => {
  const d = await compile();
  expect(d.emitters).toHaveLength(1);
  const emitter = d.emitters[0];
  expect(emitter.source.softParticleParams).toEqual(soft());
  expect(emitter.softParticlePolicy.policy).toBe(DIRECT_SOFT_PARTICLE_POLICY);
  expect(Object.isFrozen(emitter.softParticlePolicy)).toBe(true);
  for (const omission of DIRECT_SOFT_PARTICLE_OMISSIONS)
    expect(emitter.omissions).toContain(omission);
  expect(() =>
    assertDirectDepthDisabledSoftMaterial(emitter, binding(emitter)),
  ).not.toThrow();
  const ordinary = await compile({ softParticleParams: undefined });
  expect(ordinary.emitters[0].softParticlePolicy).toBeNull();
  expect(
    validateDirectDepthDisabledSoftProgram(ordinary.emitters[0]),
  ).toBeNull();
  expect(() =>
    validateDirectDepthDisabledSoftProgram({
      ...emitter,
      source: { ...emitter.source, softParticleParams: undefined },
    }),
  ).toThrow("Malformed compiled");
});

test("unproven soft shapes, controls, primitives and ground passes remain unsupported", async () => {
  const values = [
    null,
    [],
    {},
    { __type: "VfxSoftParticleDefinitionData" },
    { ...soft(), __type: "unknown" },
    { ...soft(), deltaOut: 0 },
    { ...soft(), extra: 0 },
    ...[0, -0, 1, 99, 101, false, "100", null, {}, [], NaN, Infinity].map(
      (deltaIn) => ({ ...soft(), deltaIn }),
    ),
    Object.assign(Object.create(soft()), { extra: 0 }),
  ];
  for (const value of values) {
    expect(
      compileDirectDepthDisabledSoftParticles(
        { ...source(), softParticleParams: value },
        "arbitrary-quad",
        false,
      ),
    ).toBeNull();
    const d = await compile({ softParticleParams: value });
    expect(d.emitters).toHaveLength(0);
    expect(d.unsupported[0].reasons).toContain(
      "material:soft-particle-depth-disabled-subset",
    );
  }
  for (const extra of [
    { blendMode: 0 },
    { blendMode: 4 },
    { alphaRef: undefined },
    { primitive: { __type: "VfxPrimitiveCameraQuad" } },
    { isGroundLayer: true },
  ]) {
    const d = await compile(extra);
    expect(d.emitters).toHaveLength(0);
    expect(d.unsupported[0].reasons).toContain(
      "material:soft-particle-depth-disabled-subset",
    );
  }
});

test("soft material guard rejects active depth, stale shaders, ownership and corrupt metadata", async () => {
  const emitter = (await compile()).emitters[0];
  const bad = [
    (b) => (b.environment.graphics34b = true),
    (b) => (b.environment.graphics29c = 2),
    (b) => (b.environment.pass = 5),
    (b) => (b.environment.systemFogMode = 0),
    (b) => (b.environment.unknown = 0),
    (b) => (b.nativeDefines = [{ name: "SOFT_PARTICLES", value: "1" }]),
    (b) => (b.defines = []),
    (b) => (b.shaders.pixel.sha256 = "0".repeat(64)),
    (b) => (b.shaders.vertex.sha256 = "0".repeat(64)),
    (b) => (b.effectId = "unrelated"),
    (b) => (b.emitterIndex = 1),
    (b) => (b.textures.sDepthTexture_SharedTexture = {}),
    (b) => (b.blocks[0].sceneMembers = [{ name: "cDepthConversionParams" }]),
  ];
  for (const mutate of bad) {
    const prepared = binding(emitter);
    mutate(prepared);
    expect(() =>
      assertDirectDepthDisabledSoftMaterial(emitter, prepared),
    ).toThrow("Exact native depth-disabled");
  }
  for (const value of [
    undefined,
    null,
    { ...emitter.softParticlePolicy, graphics34b: true },
    Object.create(emitter.softParticlePolicy),
    { ...emitter.softParticlePolicy, extra: true },
  ])
    expect(() =>
      assertDirectDepthDisabledSoftMaterial(
        { ...emitter, softParticlePolicy: value },
        binding(emitter),
      ),
    ).toThrow("Malformed compiled");
});
