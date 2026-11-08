import { expect, test } from "bun:test";
import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
  DIRECT_EFFECT_PROGRAM_VERSION,
  directDrawTransfers,
} from "./latest-direct-effect-runtime.mjs";
import {
  directTrailGeometry,
  directTrailHalf,
  directTrailPackedColor,
} from "./latest-direct-effect-trail.mjs";
import {
  directRenderAttributes,
  directGeometryBuffers,
} from "./latest-direct-effect-draw.mjs";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { normalizeDirectSystemAudio } from "./latest-direct-effect-audio.mjs";

const value = (constantValue, __type = "ValueVector3") => ({
  __type,
  constantValue,
});
const source = {
  __type: "VfxEmitterDefinitionData",
  lifetime: 2,
  rate: value(4, "ValueFloat"),
  particleLifetime: value(1, "ValueFloat"),
  birthScale0: value([2, 3, 1]),
  birthColor: value([1, 1, 1, 1], "ValueColor"),
  bindWeight: value(0, "ValueFloat"),
  isSingleParticle: true,
  isLocalOrientation: 0,
  particleIsLocalOrientation: 1,
  isRandomStartFrame: 1,
  numFrames: 3,
  birthUVOffset: value([1, 0], "ValueVector2"),
  texture: "trail.png",
  blendMode: 1,
  primitive: {
    __type: "VfxPrimitiveCameraTrail",
    mTrail: {
      __type: "VfxTrailDefinitionData",
      mMode: 1,
      mSmoothingMode: 1,
      mCutoff: 1000,
      mBirthTilingSize: value([100, 0, 0]),
    },
  },
};
// State-contract fakes only. Whole unchanged native trail assets and the
// original writer independently verify numeric/RNG/geometry behavior.
const kernels = {
  birth: {
    createRandom: () => {
      let draws = 0;
      return {
        next: () => ++draws / 10,
        snapshot: () => ({ draws }),
        restore: (s) => {
          draws = s.draws;
        },
      };
    },
    sampleValue: (field, _age, fallback, random, chance = null) =>
      field === source.particleLifetime
        ? ([0.05, 1, 0.05, 1][random.snapshot().draws] ?? 1)
        : field === source.birthUVOffset
          ? [chance, 0]
          : (field?.constantValue ?? fallback),
    pointOffset: () => [0, 0, -40],
  },
  values: {
    sample: (field, _age, fallback) => field?.constantValue ?? fallback,
  },
  emission: {
    eligibility: () => ({ reasons: [] }),
    count: (_source, state) => ({ count: state.hasEmitted ? 0 : 4 }),
    birthOrigins: () => [10, 20, 30, 40].map((x) => [x, 0, 0]),
    commitBirth: (e, t) => {
      e.hasEmitted = true;
      e.lastEmissionTime = t;
    },
  },
  samplers: { describe: () => ({ previewSupported: true }) },
};
const camera = { right: [1, 0, 0], up: [0, 0, 1], axis: [0, 1, 0] };
function runtime() {
  const definition = {
    id: "trail",
    programVersion: DIRECT_EFFECT_PROGRAM_VERSION,
    systemAudio: normalizeDirectSystemAudio({}),
    build,
    protocol,
    contentHash: "a".repeat(64),
    unsupported: [],
    blockers: [],
    emitters: [
      {
        index: 0,
        placementRequirements: { rootBasis: true, boundObjectSize: null },
        source,
        primitive: "camera-trail",
        trail: source.primitive.mTrail,
        offset: [0, 0, -40],
        inheritSystemBasis: false,
        bound: false,
        delay: 0,
        lifetime: 2,
        single: true,
        materialKey: "trail:0",
        blend: 1,
      },
    ],
  };
  return new LatestDirectEffectRuntime({
    build,
    protocol,
    contentHash: definition.contentHash,
    replayHash: "b".repeat(64),
    definitions: new Map([[definition.id, definition]]),
    events: [
      {
        id: "create",
        kind: "create",
        origin: "animation",
        entityId: 1,
        definitionId: definition.id,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
      },
    ],
    kernels,
    world: {
      placement: (_e, t) => ({
        resolved: true,
        position: [0, 0, 0],
        basis:
          t < 0.1 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [0, 0, -1, 0, 1, 0, 1, 0, 0],
      }),
    },
  });
}

test("trail half packing preserves original rounded-bit and overflow encodings", () => {
  for (const [input, expected] of [
    [0, 0],
    [-0, 0x8000],
    [1, 0x3c00],
    [-2, 0xc000],
    [0.25, 0x3400],
    [1.00048828125, 0x3c01],
    [65536, 0x7c00],
    [-65536, 0xfc00],
    [131072, 0x7fff],
    [-131072, 0xffff],
  ])
    expect(directTrailHalf(input)).toBe(expected);
});

test("trail packed color retains native low bytes for HDR and negative channels", () => {
  expect(directTrailPackedColor([2, -1, 0.5, 0.125])).toEqual([
    127, 1, 254, 31,
  ]);
  expect(directTrailPackedColor([1.1, -0.1, 2, 0.5])).toEqual([
    254, 231, 24, 127,
  ]);
});

test("trail cutoff transfers only generated vertex and index storage", () => {
  const attributes = new Float32Array(33);
  for (let i = 0; i < 3; i++)
    attributes.set([0, 1, 1, 1, 1, 2, 2, 1, 0, 1, 0], i * 11);
  const geometry = directTrailGeometry({
    count: 3,
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 20, 0, 0]),
    attributes,
    tiling: new Float32Array([100, 0, 100, 0, 100, 0]),
    odometer: new Float32Array([0, 10, 20]),
    mode: 0,
    smoothingMode: 0,
    smoothingQuality: 0,
    textureAddressMode: 0,
    blendMode: 1,
    cutoff: 15,
    viewForward: [0, 1, 0],
    systemScale: [1, 1],
    colorMultiplier: [1, 1, 1, 1],
    emitterUv: [0, 0],
  });
  expect(geometry.vertices.byteLength).toBe(112);
  expect(geometry.vertices.buffer.byteLength).toBe(112);
  expect(geometry.indices.byteLength).toBe(12);
  expect(geometry.indices.buffer.byteLength).toBe(12);
});

test("CameraTrail stable erasure retains ordered birth UV, tiling and odometer streams", () => {
  const r = runtime();
  r.advanceTo(0);
  let e = r.checkpoint().instances[0][1].emitters[0];
  expect(
    Array.from(e.trailData.subarray(0, 24)).filter((_, i) => i % 6 === 4),
  ).toEqual([0, 10, 20, 30]);
  r.advanceTo(0.1);
  e = r.checkpoint().instances[0][1].emitters[0];
  expect(e.count).toBe(2);
  expect([e.birthOrigins[0], e.birthOrigins[3]]).toEqual([20, 40]);
  expect([e.trailData[0], e.trailData[6]]).toEqual([
    Math.fround(0.2),
    Math.fround(0.4),
  ]);
  expect([e.trailData[4], e.trailData[10]]).toEqual([10, 30]);
  expect(e.random.draws).toBe(4);
});

test("retained trail offsets follow the current particle basis without moving birth origins", () => {
  const r = runtime();
  r.advanceTo(0.1);
  const draw = r.generateDraws(camera).draws[0],
    a = directRenderAttributes(draw);
  expect(draw.primitive).toBe("camera-trail");
  expect(draw.particleCount).toBe(2);
  const centers = Array.from({ length: 2 }, (_, i) =>
    [0, 1, 2].map(
      (lane) =>
        (a.a_POSITION[i * 6 + lane] + a.a_POSITION[i * 6 + 3 + lane]) / 2,
    ),
  );
  expect(centers).toEqual([
    [-40 + 40, 0, 0],
    [-40 + 20, 0, 0],
  ]);
  expect(directGeometryBuffers(draw).vertices).toEqual(draw.vertexBytes);
});

test("trail camera redraw, packed transfers and repeated seek preserve retained simulation", () => {
  const r = runtime();
  r.advanceTo(0.2);
  const saved = r.checkpoint(),
    before = JSON.stringify(saved),
    packet = r.generateDraws(camera);
  expect(directDrawTransfers(packet)).toHaveLength(2);
  structuredClone(packet, { transfer: directDrawTransfers(packet) });
  expect(JSON.stringify(r.checkpoint())).toBe(before);
  r.generateDraws({ right: [0, 0, -1], up: [0, 1, 0], axis: [1, 0, 0] });
  expect(JSON.stringify(r.checkpoint())).toBe(before);
  for (const time of [0.4, 0.1, 0.2, 0.6, 0.2]) r.advanceTo(time);
  expect(r.checkpoint()).toEqual(saved);
  const fast = runtime();
  for (const time of [0, 4 / 60, 8 / 60, 0.2]) fast.advanceTo(time);
  expect(fast.checkpoint()).toEqual(saved);
});

test("fractional draws exclude expired trail points without mutating the canonical pool", () => {
  const r = runtime();
  r.advanceTo(0.0505);
  const before = r.checkpoint();
  expect(before.instances[0][1].emitters[0].count).toBe(4);
  expect(r.generateDraws(camera).draws[0].particleCount).toBe(2);
  expect(r.checkpoint()).toEqual(before);
  expect(() =>
    directRenderAttributes({
      primitive: "camera-trail",
      particleCount: 2,
      vertexBytes: new Uint8Array(56),
      indices: new Uint16Array(6),
    }),
  ).toThrow("Malformed direct trail");
});

test("compiler retains unknown trail modes and unverified UV controllers as explicit omissions", async () => {
  const compile = async (overrides = {}) => {
    const bytes = new TextEncoder().encode(
        JSON.stringify({
          definition: {
            __type: "VfxSystemDefinitionData",
            complexEmitterDefinitionData: [{ ...source, ...overrides }],
          },
        }),
      ),
      manifest = {
        build,
        protocol,
        definitions: { trail: { sha256: await sha256(bytes) } },
        assets: { "trail.png": { status: "prepared", kind: "texture" } },
      };
    return compileLatestDirectEffect({
      id: "trail",
      definitionBytes: bytes,
      manifest,
      manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
      kernels,
    });
  };
  const admitted = await compile();
  expect(admitted.emitters[0].primitive).toBe("camera-trail");
  expect(admitted.emitters[0].omissions).toContain(
    "trail:supplied-smoothing-quality-zero",
  );
  const mode = await compile({
    primitive: {
      ...source.primitive,
      mTrail: { ...source.primitive.mTrail, mMode: 2 },
    },
  });
  expect(mode.emitters).toHaveLength(0);
  expect(mode.unsupported[0].reasons).toContain(
    "trail:mode-cutoff-or-smoothing",
  );
  const overflow = await compile({
    primitive: {
      ...source.primitive,
      mTrail: { ...source.primitive.mTrail, mCutoff: 1e100 },
    },
  });
  expect(overflow.emitters).toHaveLength(0);
  expect(overflow.unsupported[0].reasons).toContain(
    "trail:mode-cutoff-or-smoothing",
  );
  const scroll = await compile({
    birthUvScrollRate: value([1, 0], "ValueVector2"),
  });
  expect(scroll.emitters).toHaveLength(0);
  expect(scroll.unsupported[0].reasons).toContain("field:birthUvScrollRate");
  expect(() => directTrailGeometry({})).toThrow(
    "Unadmitted direct CameraTrail",
  );
});
