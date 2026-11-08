// Static numeric packages must retain the sign of zero from installed float32
// fields. Ordinary JSON.stringify turns -0 into 0; JSON parsing preserves -0.0.
export function stringifyAssetJson(value, space) {
  if (typeof JSON.rawJSON !== "function")
    throw Error("Static asset serialization requires JSON.rawJSON support");
  return JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item !== "number") return item;
      if (!Number.isFinite(item))
        throw Error("Static asset JSON requires finite numeric values");
      return Object.is(item, -0) ? JSON.rawJSON("-0.0") : item;
    },
    space,
  );
}
