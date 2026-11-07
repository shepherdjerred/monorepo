// Authored gear overlays; selection by a live unit remains a separate input.
import { sha256 } from "./structural-comparison.mjs";
export const UNIT_GEAR_RESOURCES_SHA =
  "8bb7aa5c8763f4ecce8f64690eb4c62cec69d2666dcda13dc0c7f6dd0b54651f";
const freeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
export async function createLatestUnitGearResources({
  profile,
  image,
  packageBytes,
}) {
  if (
    !(image instanceof Uint8Array) ||
    !(packageBytes instanceof Uint8Array) ||
    (await sha256(packageBytes)) !== UNIT_GEAR_RESOURCES_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned original unit gear package/image required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-authored-unit-gear-resources" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    meta.duplicatePolicy !== "first-native-row-with-key" ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    meta.scope.containsUnitInstances ||
    !meta.scope.valuesAreUnfixedReferenceTokens ||
    meta.scope.liveUnitGearSelectionRecovered ||
    meta.scope.liveResourceStackReconstructed ||
    meta.scope.effectFactoryExecuted
  )
    throw Error("Unsupported authored unit gear build/contract");
  for (const b of meta.originalBlocks)
    if ((await sha256(image.subarray(b.rva, b.rva + b.size))) !== b.sha256)
      throw Error("Original gear instructions changed");
  const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
  for (const entries of Object.values(meta.actors)) {
    if (!Array.isArray(entries) || entries.length > 128)
      throw Error("Invalid authored gear table");
    for (const [index, entry] of entries.entries()) {
      if (
        entry.index !== index ||
        !uint(entry.gearIdentity) ||
        typeof entry.resolverPresent !== "boolean" ||
        !Array.isArray(entry.rows) ||
        entry.rows.length > 65536 ||
        (!entry.resolverPresent && entry.rows.length) ||
        entry.rows.some(
          (row, i) =>
            !uint(row.key) ||
            !uint(row.value) ||
            (i > 0 && entry.rows[i - 1].key > row.key),
        )
      )
        throw Error("Invalid original authored gear rows");
    }
  }
  freeze(meta);
  return Object.freeze({
    metadata: meta,
    lookupAuthoredEntry(actorKey, index, key) {
      if (!Object.hasOwn(meta.actors, actorKey))
        throw Error("Unprepared authored unit gear table");
      if (!Number.isInteger(index) || index < -128 || index > 127 || !uint(key))
        throw Error(
          "Native signed gear index and unsigned resource key required",
        );
      const entries = meta.actors[actorKey];
      if (index < 0 || index >= entries.length)
        return Object.freeze({
          status: "native-selection-rejected",
          actorKey,
          index,
        });
      const entry = entries[index],
        common = {
          actorKey,
          index,
          gearIdentity: entry.gearIdentity,
          resourceKey: key,
          liveUnitSelectionVerified: false,
          referenceLinksFixed: false,
        };
      if (!entry.resolverPresent)
        return Object.freeze({ ...common, status: "null-gear-resolver" });
      let low = 0,
        high = entry.rows.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (entry.rows[mid].key < key) low = mid + 1;
        else high = mid;
      }
      const row = entry.rows[low];
      if (!row || row.key !== key)
        return Object.freeze({ ...common, status: "key-absent" });
      return Object.freeze({
        ...common,
        status:
          row.value === 0
            ? "matched-authored-null"
            : "matched-authored-reference",
        referenceToken: row.value,
        nativeRowIndex: low,
      });
    },
  });
}
