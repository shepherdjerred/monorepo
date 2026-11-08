const f = Math.fround;
export const DIRECT_ABSENT_ROTATION_CONTROLLER_POLICY =
  "native-arbitrary-absent-rotation0-controller-v1";
const invalid = Symbol("invalid data field");
const plain = (value) =>
  value !== null &&
  typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype;
const data = (value, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : invalid;
};

// Original175e250..175e35d loads +438 when its +448 curve is NULL.
// The original typed constructor gives an absent rotation0 positive-zero XYZ.
// This capability deliberately does not accept an authored rotation0, even null.
export function compileDirectAbsentRotationController(source, primitive) {
  if (
    !plain(source) ||
    primitive !== "arbitrary-quad" ||
    Object.hasOwn(source, "rotation0")
  )
    return null;
  const flag = data(source, "isRotationEnabled"),
    authoredPrimitive = data(source, "primitive");
  if (
    ![0, 1, false, true].includes(flag) ||
    !plain(authoredPrimitive) ||
    data(authoredPrimitive, "__type") !== "VfxPrimitiveArbitraryQuad"
  )
    return null;
  return Object.freeze({
    schema: 1,
    policy: DIRECT_ABSENT_ROTATION_CONTROLLER_POLICY,
    enabled: Boolean(flag),
    curve: "absent",
    constant: Object.freeze([0, 0, 0]),
  });
}

export function validateDirectAbsentRotationController(
  program,
  source,
  primitive,
  integratedRotation,
) {
  const expected = compileDirectAbsentRotationController(source, primitive);
  if (!expected) {
    if (program !== undefined && program !== null)
      throw Error("Unexpected absent rotation controller program");
    return false;
  }
  if (
    !plain(program) ||
    integratedRotation !== null ||
    Reflect.ownKeys(program).length !== 5 ||
    data(program, "schema") !== 1 ||
    data(program, "policy") !== expected.policy ||
    data(program, "enabled") !== expected.enabled ||
    data(program, "curve") !== "absent"
  )
    throw Error("Compiled absent rotation controller differs from source");
  const constant = data(program, "constant");
  if (
    !Array.isArray(constant) ||
    Object.getPrototypeOf(constant) !== Array.prototype ||
    Reflect.ownKeys(constant).length !== 4 ||
    constant.length !== 3 ||
    ![0, 1, 2].every((i) => Object.is(data(constant, String(i)), 0))
  )
    throw Error(
      "Original absent rotation controller requires positive-zero XYZ",
    );
  return true;
}

// Preserve the enabled path's addition, including -0 + +0 -> +0. The original
// FLT_MAX lifetime branch bypasses it; disabled controls also retain birth bits.
export function applyDirectAbsentRotationController(
  rotation,
  program,
  lifetime,
) {
  if (
    !Array.isArray(rotation) ||
    rotation.length !== 3 ||
    !rotation.every((v) => typeof v === "number" && Number.isFinite(f(v))) ||
    typeof lifetime !== "number" ||
    !Number.isFinite(f(lifetime)) ||
    f(lifetime) <= 0 ||
    program?.policy !== DIRECT_ABSENT_ROTATION_CONTROLLER_POLICY ||
    typeof program.enabled !== "boolean"
  )
    throw Error(
      "Verified absent rotation controller and finite particle inputs required",
    );
  lifetime = f(lifetime);
  if (!program.enabled || lifetime === 3.4028234663852886e38)
    return rotation.map(f);
  const addition = f(f(0 * 60) * lifetime);
  return rotation.map((v) => f(f(v) + addition));
}
