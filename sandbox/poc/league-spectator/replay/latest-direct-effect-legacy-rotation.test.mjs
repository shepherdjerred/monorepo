import { expect, test } from "bun:test";
import {
  compileDirectLegacyShapeRotation as compile,
  validateDirectLegacyShapeRotation as validate,
  sampleDirectLegacyShapeRotation as sample,
} from "./latest-direct-effect-legacy-rotation.mjs";
import { sampleDirectEffectBirth } from "./latest-direct-effect-birth.mjs";
function source() {
  const value = () => ({
    __type: "ValueFloat",
    constantValue: 1,
    dynamics: {
      __type: "VfxAnimatedFloatVariableData",
      probabilityTables: [
        {
          __type: "VfxProbabilityTableData",
          keyTimes: [0, 1],
          keyValues: [0, 360],
        },
      ],
      times: [0],
      values: [1],
    },
  });
  return {
    isSingleParticle: 1,
    bindWeight: { __type: "ValueFloat", constantValue: 0 },
    SpawnShape: {
      __type: "VfxShapeLegacy",
      emitRotationAngles: [value(), value()],
      emitRotationAxes: [
        [1.0000001192092896, 0, 0],
        [0, 1.0000001192092896, 0],
      ],
    },
  };
}
test("Legacy zero-vector subset retains exact authored declarations and rejects unproved vectors/axes/distributions", () => {
  const s = source(),
    program = compile(s, "camera-quad");
  expect(program).not.toBeNull();
  expect(program.angles).toEqual(s.SpawnShape.emitRotationAngles);
  expect(program.axes).toEqual(s.SpawnShape.emitRotationAxes);
  for (const mutate of [
    (s) => {
      s.birthVelocity = { __type: "ValueVector3", constantValue: [0, 0, 0] };
    },
    (s) => {
      s.birthRotation0 = { __type: "ValueVector3", constantValue: [0, 0, 0] };
    },
    (s) => {
      s.SpawnShape.emitOffset = {
        __type: "ValueVector3",
        constantValue: [0, 0, 0],
      };
    },
    (s) => {
      s.SpawnShape.emitRotationAxes[0][0] = 1;
    },
    (s) => {
      s.SpawnShape.emitRotationAngles[0].constantValue = 0;
    },
    (s) => {
      s.SpawnShape.emitRotationAngles[0].dynamics.probabilityTables[0].keyValues =
        [0, 180];
    },
    (s) => {
      s.bindWeight.constantValue = 1;
    },
    (s) => {
      s.bindWeight.constantValue = -0;
    },
    (s) => {
      s.isSingleParticle = 0;
    },
    (s) => {
      s.rotation0 = null;
    },
    (s) => {
      s.timeBeforeFirstEmission = 0;
    },
  ]) {
    const changed = source();
    mutate(changed);
    expect(compile(changed, "camera-quad")).toBeNull();
  }
  expect(compile(source(), "arbitrary-quad")).toBeNull();
  s.SpawnShape.emitRotationAngles[0].constantValue = 2;
  expect(program.angles[0].constantValue).toBe(1);
});
test("forged compiled data cannot remove or reinterpret the source-owned post-chance program", () => {
  const s = source(),
    emitter = {
      source: s,
      primitive: "camera-quad",
      bound: false,
      single: true,
      offset: [0, 0, 0],
      legacyShapeRotationProgram: compile(s, "camera-quad"),
    };
  expect(() => validate(emitter)).not.toThrow();
  for (const mutate of [
    (e) => {
      delete e.legacyShapeRotationProgram;
    },
    (e) => {
      e.legacyShapeRotationProgram.rngOrder = "before-chance";
    },
    (e) => {
      e.legacyShapeRotationProgram.axes[0][0] = 1;
    },
    (e) => {
      e.offset = [1, 0, 0];
    },
    (e) => {
      e.bound = true;
    },
    (e) => {
      e.source.birthVelocity = {
        __type: "ValueVector3",
        constantValue: [0, 0, 0],
      };
    },
  ]) {
    const changed = structuredClone(emitter);
    mutate(changed);
    expect(() => validate(changed)).toThrow();
  }
});
test("two shape samples follow retained chance without replacing it or changing previous birth sampling", () => {
  const calls = [],
    random = {
      next: () => {
        calls.push("random");
        return calls.length;
      },
    },
    birth = {
      sampleValue: (field, age, fallback, rng) => {
        calls.push(field?.__type ?? "default");
        if (field?.__type === "ValueFloat") return rng.next();
        return fallback;
      },
    };
  const value = sampleDirectEffectBirth(birth, {}, 0, random);
  const chanceAt = calls.length;
  expect(value.chance).toBe(chanceAt);
  const angles = sample(compile(source(), "camera-quad"), birth, 0, random);
  expect(angles).toEqual([chanceAt + 2, chanceAt + 4]);
  expect(value.chance).toBe(chanceAt);
  expect(calls.slice(chanceAt)).toEqual([
    "ValueFloat",
    "random",
    "ValueFloat",
    "random",
  ]);
});
