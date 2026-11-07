const keys = (value, names) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const array = (value, length) =>
  Array.isArray(value) &&
  value.length === length &&
  Object.keys(value).length === length &&
  Array.from({ length }, (_, i) => Object.hasOwn(value, i)).every(Boolean);
const positiveZero = (value) => Object.is(value, 0);

// Native typed-reader/postload/emitter controls establish this exact authored
// singleton-zero form has the same birth/RNG/clocks/geometry as an absent or
// explicit constant-zero position. Other animated positions remain unresolved.
export function directConstantEmitterPosition(value) {
  if (value === undefined) return undefined;
  if (
    keys(value, ["__type", "constantValue"]) &&
    value.__type === "ValueVector3" &&
    array(value.constantValue, 3) &&
    value.constantValue.every(
      (n) => typeof n === "number" && Number.isFinite(Math.fround(n)),
    )
  )
    return value.constantValue.map(Math.fround);
  if (!keys(value, ["__type", "dynamics"]) || value.__type !== "ValueVector3")
    return null;
  const d = value.dynamics;
  if (
    !keys(d, ["__type", "times", "values", "probabilityTables"]) ||
    d.__type !== "VfxAnimatedVector3fVariableData" ||
    !array(d.times, 1) ||
    !positiveZero(d.times[0]) ||
    !array(d.values, 1) ||
    !array(d.values[0], 3) ||
    !d.values[0].every(positiveZero) ||
    !array(d.probabilityTables, 3) ||
    !d.probabilityTables.every(
      (table) =>
        keys(table, ["__type"]) && table.__type === "VfxProbabilityTableData",
    )
  )
    return null;
  return [0, 0, 0];
}
