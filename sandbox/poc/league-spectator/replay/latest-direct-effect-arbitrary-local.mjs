import { directConstantEmitterPosition } from "./latest-direct-effect-position.mjs";

const keys = (value, names) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const absent = (source, name) =>
  !Object.hasOwn(source, name) && source[name] === undefined;
const vector = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  Reflect.ownKeys(value).length === 4 &&
  [0, 1, 2].every(
    (index) =>
      Object.hasOwn(value, index) &&
      typeof value[index] === "number" &&
      Number.isFinite(Math.fround(value[index])),
  );
const constantVector = (value) =>
  keys(value, ["__type", "constantValue"]) &&
  value.__type === "ValueVector3" &&
  vector(value.constantValue);
const sameVector = (a, b) =>
  vector(a) &&
  vector(b) &&
  a.every((value, index) => Object.is(value, b[index]));
const motionFields = [
  "SpawnShape",
  "isLocalOrientation",
  "birthVelocity",
  "birthRotationalVelocity0",
  "rotation0",
  "isRotationEnabled",
  "birthDrag",
  "drag",
  "acceleration",
  "worldAcceleration",
  "velocity",
  "velocity0",
  "forces",
];
export const DIRECT_ARBITRARY_LOCAL_ORIENTATION_POLICY =
  "native-arbitrary-local-orientation-v1";

// Complete original controls retain local translation AND rotation axes under
// the current system basis. World origin/anchor translation is added afterward.
// The unbound extension retains its original birth-world origin. It admits no
// authored local position, so no unproved unbound offset transform is implied.
export function compileDirectArbitraryLocalOrientationProgram(
  source,
  primitive = "arbitrary-quad",
) {
  if (
    !source ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    [
      "__type",
      "primitive",
      "particleIsLocalOrientation",
      "isSingleParticle",
      "bindWeight",
      "birthRotation0",
    ].some((name) => !Object.hasOwn(source, name)) ||
    source.__type !== "VfxEmitterDefinitionData" ||
    primitive !== "arbitrary-quad" ||
    !keys(source.primitive, ["__type"]) ||
    source.primitive.__type !== "VfxPrimitiveArbitraryQuad" ||
    ![true, 1].includes(source.particleIsLocalOrientation) ||
    ![true, 1].includes(source.isSingleParticle) ||
    !keys(source.bindWeight, ["__type", "constantValue"]) ||
    source.bindWeight.__type !== "ValueFloat" ||
    ![0, 1].some((value) =>
      Object.is(source.bindWeight.constantValue, value),
    ) ||
    motionFields.some((name) => !absent(source, name)) ||
    !constantVector(source.birthRotation0)
  )
    return null;
  const unbound = Object.is(source.bindWeight.constantValue, 0);
  if (unbound && !absent(source, "EmitterPosition")) return null;
  const position = directConstantEmitterPosition(source.EmitterPosition);
  if (
    position === null ||
    (!absent(source, "EmitterPosition") &&
      (!Object.hasOwn(source, "EmitterPosition") ||
        !constantVector(source.EmitterPosition)))
  )
    return null;
  return Object.freeze({
    schema: unbound ? 2 : 1,
    policy: DIRECT_ARBITRARY_LOCAL_ORIENTATION_POLICY,
    useCurrentRootBasisForAxes: true,
    useCurrentRootBasisForPosition: !unbound,
    ...(unbound ? { positionPolicy: "retained-birth-world-origin" } : {}),
  });
}

export function validateDirectArbitraryLocalOrientationProgram(emitter) {
  const expected = compileDirectArbitraryLocalOrientationProgram(
      emitter.source,
      emitter.primitive,
    ),
    actual = emitter.arbitraryLocalOrientationProgram;
  if (!expected) {
    if (actual != null)
      throw Error("Unexpected arbitrary local-orientation program");
    return null;
  }
  const position = directConstantEmitterPosition(
    emitter.source.EmitterPosition,
  );
  if (
    !keys(actual, Object.keys(expected)) ||
    Object.entries(expected).some(
      ([name, value]) => !Object.is(actual[name], value),
    ) ||
    emitter.bound !== (expected.schema === 1) ||
    emitter.single !== true ||
    emitter.inheritSystemBasis !== true ||
    !sameVector(emitter.offset, [0, 0, 0]) ||
    (position === undefined
      ? emitter.emitterPosition !== undefined
      : !sameVector(emitter.emitterPosition, position)) ||
    emitter.velocity !== undefined ||
    emitter.angularVelocity !== undefined ||
    emitter.integratedRotation != null ||
    emitter.placementRequirements?.rootBasis !== true
  )
    throw Error("Malformed compiled arbitrary local-orientation program");
  return expected;
}
