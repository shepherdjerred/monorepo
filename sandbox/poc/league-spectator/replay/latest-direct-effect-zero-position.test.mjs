import { expect, test } from "bun:test";
import { directConstantEmitterPosition } from "./latest-direct-effect-position.mjs";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
} from "./latest-direct-effect-runtime.mjs";
import { sha256 } from "./structural-comparison.mjs";

const zero = () => ({
  __type: "ValueVector3",
  dynamics: {
    __type: "VfxAnimatedVector3fVariableData",
    times: [0],
    values: [[0, 0, 0]],
    probabilityTables: Array.from({ length: 3 }, () => ({
      __type: "VfxProbabilityTableData",
    })),
  },
});
const malformed = () => {
  const cases = [];
  for (const mutate of [
    (v) => {
      v.constantValue = [0, 0, 0];
    },
    (v) => {
      v.singleValue = 0;
    },
    (v) => {
      v.__type = "IntegratedValueVector3";
    },
    (v) => {
      v.dynamics.extra = 0;
    },
    (v) => {
      v.dynamics.__type = "unknown";
    },
    (v) => {
      v.dynamics.times = [-0];
    },
    (v) => {
      v.dynamics.times = [1];
    },
    (v) => {
      v.dynamics.times = ["0"];
    },
    (v) => {
      v.dynamics.times = [];
    },
    (v) => {
      v.dynamics.times = [0, 1];
      v.dynamics.values.push([0, 0, 0]);
    },
    (v) => {
      v.dynamics.values[0][0] = -0;
    },
    (v) => {
      v.dynamics.values[0][1] = 1;
    },
    (v) => {
      v.dynamics.values[0][2] = false;
    },
    (v) => {
      v.dynamics.values = [];
    },
    (v) => {
      v.dynamics.probabilityTables = [];
    },
    (v) => {
      v.dynamics.probabilityTables.push({ __type: "VfxProbabilityTableData" });
    },
    (v) => {
      v.dynamics.probabilityTables[0] = null;
    },
    (v) => {
      v.dynamics.probabilityTables[0].__type = "unknown";
    },
    (v) => {
      v.dynamics.probabilityTables[0].keyTimes = [];
    },
    (v) => {
      v.dynamics.probabilityTables[0].keyValues = [0];
    },
    (v) => {
      v.dynamics.probabilityTables[0].singleValue = 0;
    },
  ]) {
    const value = zero();
    mutate(value);
    cases.push(value);
  }
  return cases;
};
const kernels = {
  birth: {
    sampleValue: (field, _time, fallback) => field?.constantValue ?? fallback,
    createRandom: () => ({
      next: () => 0.5,
      snapshot: () => ({}),
      restore: () => {},
    }),
  },
  emission: {
    eligibility: () => ({ reasons: [] }),
    count: () => ({ count: 0 }),
  },
  samplers: { describe: () => ({ previewSupported: true }) },
};
async function compile(position, transform = (s) => s) {
  const definitionBytes = new TextEncoder().encode(
    transform(
      JSON.stringify({
        definition: {
          __type: "VfxSystemDefinitionData",
          complexEmitterDefinitionData: [
            {
              __type: "VfxEmitterDefinitionData",
              texture: "control.png",
              blendMode: 1,
              EmitterPosition: position,
            },
          ],
        },
      }),
    ),
  );
  const id = "generic/zero-position",
    manifest = {
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
    kernels,
  });
}

test("only exact positive singleton-zero position curves normalize without replacing authored source", async () => {
  const field = zero(),
    saved = structuredClone(field);
  expect(directConstantEmitterPosition(field)).toEqual([0, 0, 0]);
  expect(field).toEqual(saved);
  expect(directConstantEmitterPosition(undefined)).toBeUndefined();
  expect(
    directConstantEmitterPosition({
      __type: "ValueVector3",
      constantValue: [-0, 4, 5],
    }),
  ).toEqual([-0, 4, 5]);
  expect(directConstantEmitterPosition(null)).toBeNull();
  for (const invalid of malformed())
    expect(directConstantEmitterPosition(invalid)).toBeNull();
  const d = await compile(field);
  expect(d.emitters).toHaveLength(1);
  expect(d.emitters[0].emitterPosition).toEqual([0, 0, 0]);
  expect(d.emitters[0].source.EmitterPosition).toEqual(saved);
  expect(Object.isFrozen(d.emitters[0].source.EmitterPosition)).toBe(true);
});

test("unverified animated position forms retain the component blocker including encoded signed zero", async () => {
  for (const invalid of malformed()) {
    // JSON serialization canonicalizes signed zero; its encoded forms are
    // checked separately below while the direct helper rejects both above.
    if (
      Object.is(invalid.dynamics.times[0], -0) ||
      Object.is(invalid.dynamics.values[0]?.[0], -0)
    )
      continue;
    const d = await compile(invalid);
    expect(d.emitters).toHaveLength(0);
    expect(d.unsupported[0].reasons).toContain("position:emitter-constant");
  }
  for (const transform of [
    (s) => s.replace('"times":[0]', '"times":[-0]'),
    (s) => s.replace('"values":[[0,0,0]]', '"values":[[-0,0,0]]'),
  ]) {
    const d = await compile(zero(), transform);
    expect(d.emitters).toHaveLength(0);
    expect(d.unsupported[0].reasons).toContain("position:emitter-constant");
  }
});

test("the changed position admission rejects v17 checkpoint semantics", async () => {
  const d = await compile(zero());
  const runtime = new LatestDirectEffectRuntime({
    build,
    protocol,
    contentHash: d.contentHash,
    replayHash: "0".repeat(64),
    definitions: new Map([[d.id, d]]),
    kernels,
    events: [],
    world: { placement: () => ({ resolved: true, position: [0, 0, 0] }) },
  });
  const saved = runtime.checkpoint();
  saved.contract.runtimeVersion = 17;
  expect(() => runtime.restore(saved)).toThrow(
    "Incompatible direct effect checkpoint",
  );
});
