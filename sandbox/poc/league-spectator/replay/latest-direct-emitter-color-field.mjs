// Both source annotations identify original BIN field 0x3d7e6258. The retained
// CDTB dictionary labels it `Color`; the archived Toolkit annotation labels it
// `color`. This is a format-name projection, not a new curve/default capability.
export const DIRECT_EMITTER_COLOR_FIELD_HASH = "3d7e6258";

export function canonicalDirectEmitterColor(source) {
  if (
    source.__type !== "VfxEmitterDefinitionData" ||
    !Object.hasOwn(source, "color")
  )
    return source;
  if (Object.hasOwn(source, "Color"))
    throw Error("Duplicate original emitter color field 3d7e6258");
  const result = { ...source, Color: source.color };
  delete result.color;
  return result;
}
