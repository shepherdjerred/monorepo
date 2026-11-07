// Original ValueFloat postload16d7b00 and virtual+30 getter16d7d90.
// This resource metadata maximum deliberately excludes probability composition;
// it is not a numerical upper bound on sampled particle lifetimes.
const f = Math.fround;
const finite = (v) => Number.isFinite(v) && Number.isFinite(f(v));
const keys = (v, required, optional = []) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  required.every((k) => Object.hasOwn(v, k)) &&
  Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const dense = (v, limit) =>
  Array.isArray(v) &&
  v.length <= limit &&
  Object.keys(v).length === v.length &&
  Array.from({ length: v.length }, (_, i) => Object.hasOwn(v, i)).every(
    Boolean,
  );

function probability(table) {
  if (
    !keys(table, ["__type"], ["keyTimes", "keyValues", "singleValue"]) ||
    table.__type !== "VfxProbabilityTableData"
  )
    return false;
  if (Object.hasOwn(table, "singleValue") && !finite(table.singleValue))
    return false;
  const hasTimes = Object.hasOwn(table, "keyTimes"),
    hasValues = Object.hasOwn(table, "keyValues");
  if (hasTimes !== hasValues) return false;
  if (!hasTimes) return true;
  const times = table.keyTimes,
    values = table.keyValues;
  return (
    dense(times, 64) &&
    dense(values, 64) &&
    times.length === values.length &&
    times.every((v, i) => finite(v) && (i === 0 || f(v) >= f(times[i - 1]))) &&
    values.every(finite)
  );
}

export function compileDirectValueFloatMaximum(source) {
  if (
    !keys(source, ["__type"], ["constantValue", "dynamics"]) ||
    source.__type !== "ValueFloat" ||
    (Object.hasOwn(source, "constantValue") && !finite(source.constantValue))
  )
    return null;
  if (!Object.hasOwn(source, "dynamics")) {
    if (!Object.hasOwn(source, "constantValue")) return null;
    return {
      schema: 1,
      policy: "native-value-float-maximum-v1",
      kind: "inline-constant",
      maximum: f(source.constantValue),
      sourceKeyCount: 0,
      probabilityIncludedInMaximum: false,
    };
  }
  const d = source.dynamics;
  if (
    !keys(d, ["__type", "times", "values"], ["probabilityTables"]) ||
    d.__type !== "VfxAnimatedFloatVariableData" ||
    !dense(d.times, 1) ||
    d.times.length !== 1 ||
    !finite(d.times[0]) ||
    !dense(d.values, 1) ||
    d.values.length !== 1 ||
    !finite(d.values[0])
  )
    return null;
  if (
    Object.hasOwn(d, "probabilityTables") &&
    (!dense(d.probabilityTables, 1) || !d.probabilityTables.every(probability))
  )
    return null;
  return {
    schema: 1,
    policy: "native-value-float-maximum-v1",
    kind: "singleton-resource",
    maximum: f(d.values[0]),
    sourceKeyCount: 1,
    probabilityIncludedInMaximum: false,
  };
}
