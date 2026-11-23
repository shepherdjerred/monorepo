// Original Legacy +38 callback samples rotation probabilities after the
// retained chance. This subset has three constructor-zero shape vectors: the
// original matrix operations preserve their bytes, but consume both samples.
import { sameDirectCompiledData as same } from "./latest-direct-compiled-restore.mjs";
const ownKeys = (value, expected) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).length === expected.length &&
  expected.every(
    (key) =>
      Object.hasOwn(value, key) &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
  );
const dense = (value, size) =>
  Array.isArray(value) &&
  value.length === size &&
  Reflect.ownKeys(value).length === size + 1 &&
  Array.from(
    { length: size },
    (_, index) =>
      Object.hasOwn(value, index) &&
      Object.hasOwn(
        Object.getOwnPropertyDescriptor(value, String(index)),
        "value",
      ),
  ).every(Boolean);
const angle = (value) =>
  ownKeys(value, ["__type", "constantValue", "dynamics"]) &&
  value.__type === "ValueFloat" &&
  Object.is(value.constantValue, 1) &&
  ownKeys(value.dynamics, ["__type", "probabilityTables", "times", "values"]) &&
  value.dynamics.__type === "VfxAnimatedFloatVariableData" &&
  same(value.dynamics.times, [0]) &&
  same(value.dynamics.values, [1]) &&
  dense(value.dynamics.probabilityTables, 1) &&
  ownKeys(value.dynamics.probabilityTables[0], [
    "__type",
    "keyTimes",
    "keyValues",
  ]) &&
  value.dynamics.probabilityTables[0].__type === "VfxProbabilityTableData" &&
  same(value.dynamics.probabilityTables[0].keyTimes, [0, 1]) &&
  same(value.dynamics.probabilityTables[0].keyValues, [0, 360]);
export const DIRECT_LEGACY_ZERO_VECTOR_ROTATION_POLICY =
  "native-legacy-post-chance-zero-vector-rotation-v1";
export function compileDirectLegacyShapeRotation(source, primitive) {
  const shape = source?.SpawnShape;
  if (
    primitive !== "camera-quad" ||
    source.isSingleParticle !== 1 ||
    !Object.is(source.bindWeight?.constantValue, 0) ||
    source.bindWeight?.dynamics ||
    [
      "birthVelocity",
      "birthRotation0",
      "birthRotationalVelocity0",
      "rotation0",
      "isRotationEnabled",
      "particleIsLocalOrientation",
      "FlexShapeDefinition",
      "timeBeforeFirstEmission",
    ].some((key) => Object.hasOwn(source, key)) ||
    !ownKeys(shape, ["__type", "emitRotationAngles", "emitRotationAxes"]) ||
    shape.__type !== "VfxShapeLegacy" ||
    !dense(shape.emitRotationAngles, 2) ||
    !shape.emitRotationAngles.every(angle) ||
    !same(shape.emitRotationAxes, [
      [1.0000001192092896, 0, 0],
      [0, 1.0000001192092896, 0],
    ])
  )
    return null;
  return {
    schema: 1,
    policy: DIRECT_LEGACY_ZERO_VECTOR_ROTATION_POLICY,
    primitive: "camera-quad",
    samplerRva: 0x170a850,
    afterChanceRva: 0x170ab10,
    zeroShapeVectors: 3,
    clock: "normalized-emitter-age",
    rngOrder: "after-retained-chance",
    angles: structuredClone(shape.emitRotationAngles),
    axes: structuredClone(shape.emitRotationAxes),
  };
}
export function validateDirectLegacyShapeRotation(emitter) {
  const expected = compileDirectLegacyShapeRotation(
      emitter.source,
      emitter.primitive,
    ),
    actual = emitter.legacyShapeRotationProgram;
  if (!expected) {
    if (actual != null)
      throw Error("Unexpected compiled Legacy shape rotation");
    return null;
  }
  if (
    !same(actual, expected) ||
    !same(emitter.offset, [0, 0, 0]) ||
    emitter.bound !== false ||
    emitter.single !== true
  )
    throw Error("Malformed compiled Legacy shape rotation");
  return expected;
}
export function sampleDirectLegacyShapeRotation(
  program,
  birth,
  normalizedAge,
  random,
) {
  if (
    program?.policy !== DIRECT_LEGACY_ZERO_VECTOR_ROTATION_POLICY ||
    typeof birth?.sampleValue !== "function" ||
    !Number.isFinite(Math.fround(normalizedAge))
  )
    throw Error("Owned Legacy shape rotation kernel and finite clock required");
  return program.angles.map((field) =>
    birth.sampleValue(field, Math.fround(normalizedAge), 0, random),
  );
}
