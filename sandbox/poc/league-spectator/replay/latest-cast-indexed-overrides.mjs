// Original converter82c360 consumes the plain decoded packet count at+60.
// Empty producer lists establish absence; nonempty lists remain untranslated.
export function readCastIndexedOverrideCount(object, base) {
  if (
    !(object instanceof Uint8Array) ||
    !Number.isSafeInteger(base) ||
    base < 0 ||
    base > object.byteLength - 0x64
  )
    throw Error("Bounded original CastInfo object and base required");
  return new DataView(
    object.buffer,
    object.byteOffset,
    object.byteLength,
  ).getUint32(base + 0x60, true);
}
export function requireEmptyCastIndexedOverrides(cast) {
  if (
    !Number.isInteger(cast?.indexedOverrideCount) ||
    cast.indexedOverrideCount < 0 ||
    cast.indexedOverrideCount > 0xffffffff
  )
    throw Error("Explicit decoded CastInfo indexed override count required");
  return cast.indexedOverrideCount === 0
    ? {
        resolved: true,
        travelTimeOverride: null,
        provenance: "original-network-empty-indexed-override-producer",
      }
    : {
        resolved: false,
        reason: "cast:nonempty-indexed-overrides-untranslated",
      };
}
