const keys = (v, required, optional = []) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  required.every((key) => Object.hasOwn(v, key)) &&
  Reflect.ownKeys(v).every(
    (key) => required.includes(key) || optional.includes(key),
  );
const dense = (v, length) =>
  Array.isArray(v) &&
  v.length === length &&
  Reflect.ownKeys(v).length === length + 1 &&
  Array.from({ length }, (_, i) => Object.hasOwn(v, i)).every(Boolean);
const finite = (v) => Number.isFinite(v) && Number.isFinite(Math.fround(v));
const vector = (v) => dense(v, 3) && v.every(finite);
function field(v) {
  if (
    !keys(v, ["__type"], ["constantValue", "dynamics"]) ||
    v.__type !== "ValueVector3" ||
    (!Object.hasOwn(v, "constantValue") && !Object.hasOwn(v, "dynamics")) ||
    (Object.hasOwn(v, "constantValue") && !vector(v.constantValue))
  )
    return false;
  if (!Object.hasOwn(v, "dynamics")) return true;
  const d = v.dynamics;
  if (
    !keys(d, ["__type", "times", "values"], ["probabilityTables"]) ||
    d.__type !== "VfxAnimatedVector3fVariableData" ||
    !Array.isArray(d.times) ||
    d.times.length < 1 ||
    d.times.length > 64 ||
    !dense(d.times, d.times.length) ||
    !d.times.every(
      (t, i) =>
        finite(t) && (i === 0 || Math.fround(t) > Math.fround(d.times[i - 1])),
    ) ||
    !dense(d.values, d.times.length) ||
    !d.values.every(vector)
  )
    return false;
  return (
    !Object.hasOwn(d, "probabilityTables") ||
    (dense(d.probabilityTables, 3) &&
      d.probabilityTables.every(
        (p) => keys(p, ["__type"]) && p.__type === "VfxProbabilityTableData",
      ))
  );
}
export const DIRECT_LEGACY_OFFSET_POLICY = "native-legacy-offset-v1";
export const DIRECT_LEGACY_OFFSET_OMISSION =
  "source:prepared-json-curve-signed-zero-not-preserved";
export function compileDirectLegacyOffsetProgram(shape, primitive) {
  if (
    !["camera-quad", "arbitrary-quad"].includes(primitive) ||
    !keys(shape, ["__type", "emitOffset"]) ||
    shape.__type !== "VfxShapeLegacy" ||
    !field(shape.emitOffset)
  )
    return null;
  return {
    schema: 1,
    policy: DIRECT_LEGACY_OFFSET_POLICY,
    clock: "normalized-emitter-age",
    field: structuredClone(shape.emitOffset),
  };
}
const same = (a, b) => {
  if (Array.isArray(b))
    return dense(a, b.length) && b.every((v, i) => same(a[i], v));
  if (b !== null && typeof b === "object")
    return (
      keys(a, Object.keys(b)) &&
      Object.keys(b).every((key) => same(a[key], b[key]))
    );
  return Object.is(a, b);
};
export function validateDirectLegacyOffsetProgram(emitter) {
  const expected = compileDirectLegacyOffsetProgram(
      emitter.source?.SpawnShape,
      emitter.primitive,
    ),
    actual = emitter.legacyOffsetProgram;
  if (!expected) {
    if (actual != null)
      throw Error("Unexpected compiled Legacy offset program");
    return null;
  }
  if (
    !same(actual, expected) ||
    emitter.offset !== null ||
    emitter.placementRequirements?.rootBasis !== true
  )
    throw Error("Malformed compiled Legacy offset program");
  return expected;
}
// Constructor admission owns validation. The shared verified value kernel
// evaluates this non-random field at the original normalized emitter clock;
// no extra random samples or per-display-frame shape re-evaluation occurs.
export function sampleDirectLegacyOffset(program, normalizedAge, values) {
  if (!finite(normalizedAge) || typeof values?.sample !== "function")
    throw Error("Owned Legacy shape clock/value kernel required");
  return values.sample(program.field, Math.fround(normalizedAge), [0, 0, 0]);
}
