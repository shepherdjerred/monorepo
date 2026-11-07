import { expect, test } from "bun:test";
import {
  compileDirectIntegratedRotation,
  sampleDirectIntegratedRotation,
  directIntegratedParticleRotation,
  validateDirectIntegratedRotation,
} from "./latest-direct-effect-integrated-rotation.mjs";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import {
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
} from "./latest-direct-effect-runtime.mjs";
import { sha256 } from "./structural-comparison.mjs";

const source = () => ({
  __type: "IntegratedValueVector3",
  constantValue: [1, 1, 1],
  dynamics: {
    __type: "VfxAnimatedVector3fVariableData",
    times: [0, 1],
    values: [
      [0, 4, 0],
      [0, 4, 0],
    ],
  },
});

async function compile(extra) {
  const id = "generic/integrated-rotation-control",
    definitionBytes = new TextEncoder().encode(
      JSON.stringify({
        definition: {
          __type: "VfxSystemDefinitionData",
          complexEmitterDefinitionData: [
            {
              __type: "VfxEmitterDefinitionData",
              texture: "control.png",
              blendMode: 1,
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
test("camera integrated programs preserve raw curves and explicit typed enable values", async () => {
  for (const flag of [0, 1, false, true]) {
    const curve = source(),
      d = await compile({ rotation0: curve, isRotationEnabled: flag });
    expect(d.emitters).toHaveLength(1);
    expect(d.emitters[0].source.rotation0).toEqual(curve);
    expect(d.emitters[0].source.isRotationEnabled).toBe(flag);
    expect(d.emitters[0].integratedRotation).toEqual(
      flag ? compileDirectIntegratedRotation(curve) : null,
    );
  }
  const base = await compile({});
  expect(base.emitters[0].integratedRotation).toBeNull();
  for (const flag of [undefined, null, 2, "1", {}, []]) {
    const d = await compile({ rotation0: source(), isRotationEnabled: flag });
    expect(d.emitters).toHaveLength(0);
    expect(d.unsupported[0].reasons).toContain(
      "rotation:explicit-typed-enable-required",
    );
  }
  const arbitrary = await compile({
    rotation0: source(),
    isRotationEnabled: 1,
    primitive: { __type: "VfxPrimitiveArbitraryQuad" },
  });
  expect(arbitrary.unsupported[0].reasons).toContain(
    "rotation:camera-controller-only",
  );
  const missing = await compile({ isRotationEnabled: 1 });
  expect(missing.unsupported[0].reasons).toContain(
    "rotation:flat-integrated-controller",
  );
});
test("flat integrated rotation preserves authored input and the original biased endpoint", () => {
  const value = source(),
    saved = structuredClone(value),
    program = compileDirectIntegratedRotation(value);
  expect(value).toEqual(saved);
  expect(program.sampleCount).toBe(64);
  expect(program.samples).toHaveLength(192);
  expect(sampleDirectIntegratedRotation(program, 1)).toEqual([
    0, 3.999959945678711, 0,
  ]);
  expect(sampleDirectIntegratedRotation(program, -1)).toEqual([0, 0, 0]);
  expect(sampleDirectIntegratedRotation(program, 2)).toEqual(
    sampleDirectIntegratedRotation(program, 1),
  );
  expect(Object.isFrozen(program.samples)).toBe(true);
  expect(
    directIntegratedParticleRotation(
      [90, 17, -45],
      program,
      0.1,
      3.4028234663852886e38,
    ),
  ).toEqual([90, 17, -45]);
});
test("unverified integrated clocks, random curves, values and metadata remain rejected", () => {
  for (const mutate of [
    (v) => {
      v.__type = "ValueVector3";
    },
    (v) => {
      v.unknown = 0;
    },
    (v) => {
      delete v.constantValue;
    },
    (v) => {
      v.constantValue = [0, 1, 1];
    },
    (v) => {
      v.dynamics.times = [-0, 1];
    },
    (v) => {
      v.dynamics.times = [0, 0.5, 1];
    },
    (v) => {
      v.dynamics.times = [0, 2];
    },
    (v) => {
      v.dynamics.values[1][1] = 5;
    },
    (v) => {
      v.dynamics.values[0] = [0, Infinity, 0];
    },
    (v) => {
      v.dynamics.values[0] = [0, "4", 0];
    },
    (v) => {
      v.dynamics.probabilityTables = [];
    },
    (v) => {
      v.dynamics.values[0] = Array(3);
    },
    (v) => {
      v.dynamics.__type = "unknown";
    },
  ]) {
    const value = source();
    mutate(value);
    expect(compileDirectIntegratedRotation(value)).toBeNull();
  }
  expect(compileDirectIntegratedRotation(null)).toBeNull();
  expect(compileDirectIntegratedRotation(Object.create(source()))).toBeNull();
});

test("compiled rotation metadata is checked against raw source before hot sampling", () => {
  const value = source(),
    enabled = { rotation0: value, isRotationEnabled: 1 },
    program = compileDirectIntegratedRotation(value);
  expect(
    validateDirectIntegratedRotation(program, enabled, "camera-quad"),
  ).toBe(program);
  expect(validateDirectIntegratedRotation(null, {}, "camera-quad")).toBeNull();
  expect(
    validateDirectIntegratedRotation(undefined, {}, "camera-quad"),
  ).toBeUndefined();
  expect(
    validateDirectIntegratedRotation(
      null,
      { rotation0: value, isRotationEnabled: 0 },
      "camera-quad",
    ),
  ).toBeNull();
  for (const bad of [
    undefined,
    null,
    {},
    { sampleCount: 63, samples: program.samples },
    { ...program, extra: 0 },
  ])
    expect(() =>
      validateDirectIntegratedRotation(bad, enabled, "camera-quad"),
    ).toThrow();
  const corrupt = structuredClone(program);
  corrupt.samples[4] += 1;
  expect(() =>
    validateDirectIntegratedRotation(corrupt, enabled, "camera-quad"),
  ).toThrow();
  expect(() =>
    validateDirectIntegratedRotation(program, enabled, "arbitrary-quad"),
  ).toThrow();
  expect(() =>
    validateDirectIntegratedRotation(program, {}, "camera-quad"),
  ).toThrow();
  expect(() =>
    validateDirectIntegratedRotation(
      undefined,
      { rotation0: value, isRotationEnabled: 0 },
      "camera-quad",
    ),
  ).toThrow();
  expect(() =>
    validateDirectIntegratedRotation(
      program,
      Object.create(enabled),
      "camera-quad",
    ),
  ).toThrow();
});
