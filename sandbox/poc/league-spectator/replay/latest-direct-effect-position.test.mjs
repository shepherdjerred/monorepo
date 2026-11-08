import { expect, test } from "bun:test";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
} from "./latest-direct-effect-runtime.mjs";
import { directParticleWorldBasis } from "./latest-direct-effect-math.mjs";
import { sha256 } from "./structural-comparison.mjs";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const yaw90 = [0, 0, -1, 0, 1, 0, 1, 0, 0];
const value = (constantValue) => ({
  __type: Array.isArray(constantValue) ? "ValueVector3" : "ValueFloat",
  constantValue,
});
// These fakes isolate the world/birth storage contract. Full native schedules
// separately establish positions, colors, indices, timing and random streams.
const kernels = {
  birth: {
    createRandom: () => {
      let draws = 0;
      return {
        next: () => (++draws, 0.5),
        snapshot: () => ({ draws }),
        restore: (state) => {
          draws = state.draws;
        },
      };
    },
    sampleValue: (field, _age, fallback) => field?.constantValue ?? fallback,
    pointOffset: () => [0, 0, 0],
  },
  values: {
    sample: (field, _age, fallback) => field?.constantValue ?? fallback,
  },
  emission: {
    eligibility: () => ({ reasons: [] }),
    count: (_source, state) => ({ count: state.hasEmitted ? 0 : 1 }),
    birthOrigins: (_previous, current) => [current],
    commitBirth: (emitter, elapsed) => {
      emitter.hasEmitted = true;
      emitter.lastEmissionTime = elapsed;
    },
  },
  samplers: { describe: () => ({ previewSupported: true }) },
};
const source = {
  __type: "VfxEmitterDefinitionData",
  emitterName: "offset",
  lifetime: 2,
  rate: value(1),
  particleLifetime: value(1),
  birthScale0: value([2, 3, 1]),
  bindWeight: value(0),
  blendMode: 1,
  texture: "offset.png",
  primitive: { __type: "VfxPrimitiveArbitraryQuad" },
  isSingleParticle: true,
  EmitterPosition: value([80, 60, -50]),
};
async function compile(overrides = {}) {
  const definitionBytes = new TextEncoder().encode(
    JSON.stringify({
      definition: {
        __type: "VfxSystemDefinitionData",
        complexEmitterDefinitionData: [{ ...source, ...overrides }],
      },
    }),
  );
  const manifest = {
    build,
    protocol,
    definitions: { offset: { sha256: await sha256(definitionBytes) } },
    assets: { "offset.png": { status: "prepared", kind: "texture" } },
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return compileLatestDirectEffect({
    id: "offset",
    definitionBytes,
    manifest,
    manifestBytes,
    kernels,
  });
}
async function makeRuntime({
  bound = false,
  basis = (t) => (t < 0.1 ? yaw90 : identity),
  velocity,
  localOrientation,
  emitterPosition,
  placementExtra = {},
} = {}) {
  const definition = await compile({
    bindWeight: value(bound ? 1 : 0),
    ...(velocity ? { birthVelocity: value(velocity) } : {}),
    ...(localOrientation !== undefined
      ? { isLocalOrientation: localOrientation }
      : {}),
    ...(emitterPosition ? { EmitterPosition: value(emitterPosition) } : {}),
  });
  return new LatestDirectEffectRuntime({
    build,
    protocol,
    contentHash: definition.contentHash,
    replayHash: "0".repeat(64),
    definitions: new Map([[definition.id, definition]]),
    kernels,
    events: [
      {
        id: "offset:0",
        kind: "create",
        origin: "animation",
        definitionId: definition.id,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
        entityId: 1,
      },
    ],
    world: {
      placement: (_event, t) => ({
        resolved: true,
        position: [t * 10, 0, 0],
        basis: basis(t),
        ...placementExtra,
      }),
    },
  });
}
const camera = { right: [1, 0, 0], up: [0, 1, 0] };

test("constant EmitterPosition admission preserves values and rejects unverified curve and orientation behavior", async () => {
  expect((await compile()).emitters[0].emitterPosition).toEqual([80, 60, -50]);
  for (const field of [
    null,
    value([1, 2]),
    value([1, 2, "3"]),
    value([1, 2, 1e100]),
    { ...value([0, 0, 0]), dynamics: { times: [0], values: [[0, 0, 0]] } },
  ]) {
    const compiled = await compile({ EmitterPosition: field });
    expect(compiled.emitters).toHaveLength(0);
    expect(compiled.unsupported[0].reasons).toContain(
      "position:emitter-constant",
    );
  }
  const local = await compile({ isLocalOrientation: true });
  expect(local.emitters).toHaveLength(0);
  expect(local.unsupported[0].reasons).toContain("binding:local-orientation");
});

test("the native default birth basis rotates local offsets and arbitrary geometry together", async () => {
  const r = await makeRuntime();
  r.advanceTo(0);
  const first = r.generateDraws(camera).draws[0];
  expect([...first.positions.subarray(0, 3)]).toEqual([-50, 57, -82]);
  expect([
    ...r.checkpoint().instances[0][1].emitters[0].birthBases.subarray(0, 9),
  ]).toEqual(yaw90);
  const atBirth = [...first.positions];
  r.advanceTo(0.2);
  expect([...r.generateDraws(camera).draws[0].positions]).toEqual(atBirth);
  const retained = r.checkpoint();
  r.advanceTo(0.8);
  r.restore(retained);
  expect([...r.generateDraws(camera).draws[0].positions]).toEqual(atBirth);
  r.advanceTo(0);
  expect([...r.generateDraws(camera).draws[0].positions]).toEqual(atBirth);
});

test("bound origin motion preserves the constant offset and birth orientation through camera redraws", async () => {
  const r = await makeRuntime({ bound: true });
  r.advanceTo(0.2);
  const before = JSON.stringify(r.checkpoint());
  expect([
    ...r.generateDraws(camera).draws[0].positions.subarray(0, 3),
  ]).toEqual([-48, 57, -82]);
  r.generateDraws({ right: [0, 0, -1], up: [0, 1, 0] });
  expect(JSON.stringify(r.checkpoint())).toBe(before);
  const malformed = await makeRuntime({ basis: () => [1, 0] });
  expect(() => malformed.advanceTo(0)).toThrow(
    "finite column-major system basis",
  );
});

test("explicit false orientation retains identity for both offset and quad axes", async () => {
  const r = await makeRuntime({ localOrientation: false });
  r.advanceTo(0);
  expect([
    ...r.generateDraws(camera).draws[0].positions.subarray(0, 3),
  ]).toEqual([82, 57, -50]);
  expect([
    ...r.checkpoint().instances[0][1].emitters[0].birthBases.subarray(0, 9),
  ]).toEqual(identity);
});

test("constant velocity retains native float32 integration through speed, camera and seek changes", async () => {
  const options = {
    velocity: [0, 50, 0],
    emitterPosition: [0, 450, 0],
    basis: () => identity,
  };
  const r = await makeRuntime(options);
  r.advanceTo(0.5);
  const paused = JSON.stringify(r.checkpoint());
  r.generateDraws(camera);
  expect(JSON.stringify(r.checkpoint())).toBe(paused);
  r.advanceTo(1);
  const emitter = r.checkpoint().instances[0][1].emitters[0];
  expect([...emitter.motion.subarray(0, 6)]).toEqual([
    0, 500.0006103515625, 0, 0, 50, 0,
  ]);
  expect(emitter.motion[1]).not.toBe(450 + 50);
  const forward = r.checkpoint();
  const fast = await makeRuntime(options);
  for (let frame = 0; frame <= 15; frame++) fast.advanceTo(frame / 15);
  expect(fast.checkpoint()).toEqual(forward);
  r.advanceTo(0.25);
  r.advanceTo(1);
  expect(r.checkpoint()).toEqual(forward);
});

test("velocity admission rejects curves, nonfinite vectors and unverified continuous birth timing", async () => {
  for (const birthVelocity of [
    null,
    value([1, 2]),
    value([1, 2, 1e100]),
    { ...value([0, 0, 0]), dynamics: { times: [0], values: [[0, 0, 0]] } },
  ]) {
    const d = await compile({ birthVelocity });
    expect(d.emitters).toHaveLength(0);
    expect(d.unsupported[0].reasons).toContain(
      "motion:birth-velocity-constant",
    );
  }
  const continuous = await compile({
    isSingleParticle: false,
    birthVelocity: value([1, 2, 3]),
  });
  expect(continuous.emitters).toHaveLength(0);
  expect(continuous.unsupported[0].reasons).toContain(
    "motion:velocity-continuous-birth-clock",
  );
});

test("placement evidence preserves native policy inputs in coverage and checkpoint state", async () => {
  const placementExtra = {
    policy: "verified-native-control",
    basisStatus: "constructor-identity",
    nativeParentFlags: 0,
    secondaryPosition: [4, 5, 6],
  };
  const r = await makeRuntime({ placementExtra });
  r.advanceTo(0);
  expect(r.coverage({ includeRows: true }).rows[0].placementEvidence).toEqual(
    placementExtra,
  );
  expect(r.checkpoint().instances[0][1].placementEvidence).toEqual(
    placementExtra,
  );
});

test("column-major system composition applies the original birth transform", () => {
  expect(
    directParticleWorldBasis(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      yaw90,
    ),
  ).toEqual([
    [0, 0, -1],
    [0, 1, 0],
    [1, 0, 0],
  ]);
});
