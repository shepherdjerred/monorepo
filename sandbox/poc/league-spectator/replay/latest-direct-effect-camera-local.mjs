import { directConstantEmitterPosition } from "./latest-direct-effect-position.mjs";

const keys = (value, names) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const vector = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  Reflect.ownKeys(value).length === 4 &&
  [0, 1, 2].every(
    (i) =>
      Object.hasOwn(value, i) &&
      Number.isFinite(value[i]) &&
      Number.isFinite(Math.fround(value[i])),
  );
const zero = (value) => vector(value) && value.every((n) => Object.is(n, 0));
const absent = (source, key) =>
  !Object.hasOwn(source, key) && source[key] === undefined;
const sameVector = (a, b) =>
  vector(a) && vector(b) && a.every((n, i) => Object.is(n, b[i]));
const motionFields = [
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

export const DIRECT_CAMERA_LOCAL_OFFSET_POLICY =
  "native-camera-local-offset-v1";
export const DIRECT_CAMERA_LOCAL_OFFSET_OMISSION =
  "orientation:native-derived-offset-velocity-and-particle-matrix-streams-unconsumed-by-bounded-camera-writer";

// Original loaded camera emitters prove that the authored local-particle flag
// transforms the point offset by the current system basis. Retained emission
// origin interpolation remains in world space and is added after that transform.
// This is a camera-only slice; no authored particle movement/controller is waived.
export function compileDirectCameraLocalOffsetProgram(
  source,
  primitive = "camera-quad",
) {
  if (
    source === null ||
    typeof source !== "object" ||
    primitive !== "camera-quad" ||
    (!absent(source, "primitive") &&
      (!Object.hasOwn(source, "primitive") ||
        !keys(source.primitive, ["__type"]) ||
        source.primitive.__type !== "VfxPrimitiveCameraQuad")) ||
    !Object.hasOwn(source, "particleIsLocalOrientation") ||
    ![0, 1, false, true].includes(source.particleIsLocalOrientation) ||
    (!absent(source, "isLocalOrientation") &&
      (!Object.hasOwn(source, "isLocalOrientation") ||
        ![0, false].includes(source.isLocalOrientation))) ||
    (!absent(source, "isSingleParticle") &&
      (!Object.hasOwn(source, "isSingleParticle") ||
        ![0, false].includes(source.isSingleParticle))) ||
    !Object.hasOwn(source, "SpawnShape") ||
    !keys(source.SpawnShape, ["__type", "emitOffset"]) ||
    source.SpawnShape.__type !== "{ee39916f}" ||
    !vector(source.SpawnShape.emitOffset) ||
    source.SpawnShape.emitOffset.every((n) => n === 0) ||
    !Object.hasOwn(source, "bindWeight") ||
    !keys(source.bindWeight, ["__type", "constantValue"]) ||
    source.bindWeight.__type !== "ValueFloat" ||
    source.bindWeight.constantValue !== 1 ||
    motionFields.some((key) => !absent(source, key))
  )
    return null;
  const position = directConstantEmitterPosition(source.EmitterPosition);
  if (
    (!absent(source, "EmitterPosition") &&
      (!Object.hasOwn(source, "EmitterPosition") || !zero(position))) ||
    position === null
  )
    return null;
  return Object.freeze({
    schema: 1,
    policy: DIRECT_CAMERA_LOCAL_OFFSET_POLICY,
    useCurrentRootBasis: !!source.particleIsLocalOrientation,
  });
}

export function validateDirectCameraLocalOffsetProgram(emitter) {
  const expected = compileDirectCameraLocalOffsetProgram(
    emitter.source,
    emitter.primitive,
  );
  const actual = emitter.cameraLocalOffsetProgram;
  if (!expected) {
    if (actual != null) throw Error("Unexpected camera local-offset program");
    return null;
  }
  const position = directConstantEmitterPosition(
    emitter.source.EmitterPosition,
  );
  if (
    !keys(actual, ["schema", "policy", "useCurrentRootBasis"]) ||
    Object.entries(expected).some(
      ([key, value]) => !Object.is(actual[key], value),
    ) ||
    emitter.bound !== true ||
    emitter.single !== false ||
    emitter.inheritSystemBasis !==
      absent(emitter.source, "isLocalOrientation") ||
    !sameVector(
      emitter.offset,
      emitter.source.SpawnShape.emitOffset.map(Math.fround),
    ) ||
    (position === undefined
      ? emitter.emitterPosition !== undefined
      : !sameVector(emitter.emitterPosition, position)) ||
    emitter.velocity !== undefined ||
    emitter.angularVelocity !== undefined ||
    emitter.integratedRotation != null ||
    emitter.placementRequirements?.rootBasis !== true
  )
    throw Error("Malformed compiled camera local-offset program");
  return expected;
}
