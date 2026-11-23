// Original condition branch components, not a live animation-state provider.
// Inputs must come from a separately admitted updater. The float selector keeps
// its native prior-branch/delay state; this does not activate or blend children.
const finite = (value) =>
  typeof value === "number" && Number.isFinite(Math.fround(value));
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

export function selectNativeBooleanCondition(children, value) {
  if (
    !children ||
    !uint(children.trueIndex) ||
    !uint(children.falseIndex) ||
    !finite(value)
  )
    throw Error(
      "Typed original boolean condition children and updater value required",
    );
  return Math.fround(value) === 0 ? children.falseIndex : children.trueIndex;
}

export function selectNativeFloatCondition(pairs, previous, value) {
  if (
    !Array.isArray(pairs) ||
    !pairs.length ||
    pairs.length > 1024 ||
    pairs.some(
      (pair) =>
        !uint(pair.index) ||
        ![pair.threshold, pair.blendUp, pair.blendDown].every(finite),
    ) ||
    !previous ||
    !Number.isInteger(previous.ordinal) ||
    previous.ordinal < -1 ||
    previous.ordinal >= pairs.length ||
    typeof previous.transitioning !== "boolean" ||
    !finite(previous.remainingSeconds) ||
    !finite(value)
  )
    throw Error(
      "Typed original float condition pairs, state and updater value required",
    );
  value = Math.fround(value);
  let ordinal = 0;
  if (value < 0) {
    const match = pairs.findIndex(
      (pair) => Math.fround(pair.threshold) > value,
    );
    ordinal = match < 0 ? 0 : match;
  } else if (value >= Math.fround(pairs[0].threshold)) {
    ordinal = pairs.length - 1;
    for (let index = 0; index < pairs.length - 1; index++)
      if (value < Math.fround(pairs[index + 1].threshold)) {
        ordinal = index;
        break;
      }
  }
  const changed = ordinal !== previous.ordinal;
  let remainingSeconds = Math.fround(previous.remainingSeconds),
    selectedOrdinal = previous.ordinal;
  if (changed && previous.ordinal !== -1 && !previous.transitioning) {
    const old = pairs[previous.ordinal];
    remainingSeconds = Math.fround(
      Math.fround(pairs[ordinal].threshold) > Math.fround(old.threshold)
        ? old.blendUp
        : old.blendDown,
    );
  }
  if (previous.ordinal === -1 || !changed || remainingSeconds <= 0)
    selectedOrdinal = ordinal;
  return {
    index: pairs[selectedOrdinal].index,
    state: {
      ordinal: selectedOrdinal,
      remainingSeconds,
      transitioning: changed,
    },
  };
}
