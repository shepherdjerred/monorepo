import { resolveNativeClipMap } from "./native-clip-map-policy.mjs";
import { retainNativeEventMap } from "./native-event-map-policy.mjs";

// Invoked by the archive producer only after matching the source BIN digest,
// original owner/path and field. Unknown map fields remain opaque at its call
// site. Internal row IDs below do not replace the original authored event key.
export function normalizeProvedNativeActorMap({
  kind,
  opaque,
  observationBytes,
  sourceBinSha256,
  ownerPath,
  trail = [],
}) {
  if (
    opaque?.__type !== "UnresolvedOriginalBinMap" ||
    opaque.reason !== "duplicate-original-map-keys" ||
    opaque.original?.type !== "Map" ||
    !Array.isArray(opaque.entries) ||
    opaque.entries.length !== opaque.original.entries?.length ||
    opaque.entries.some(
      (entry, index) =>
        entry.sourceEntry !== index ||
        !Object.hasOwn(entry, "key") ||
        !Object.hasOwn(entry, "value"),
    )
  )
    throw Error(
      "Complete preserved normalized original duplicate map required",
    );
  const options = {
    entries: opaque.original.entries,
    observationBytes,
    sourceBinSha256,
    ownerPath,
    trail,
  };
  const resolution =
    kind === "clip"
      ? resolveNativeClipMap(options)
      : kind === "event"
        ? retainNativeEventMap(options)
        : null;
  if (!resolution)
    throw Error("Known proved native actor map consumer required");
  const rows =
    kind === "clip" ? resolution.selectedEntries : resolution.eventEntries;
  const normalized = rows.map((row) => {
    const source = opaque.entries[row.sourceIndex];
    return {
      id:
        kind === "clip"
          ? String(source.key)
          : `${source.key}@native-row-${row.nativeIndex}`,
      originalKey: source.key,
      originalKeyHash: row.key,
      sourceEntry: row.sourceIndex,
      nativeRow: row.nativeIndex,
      value: source.value,
    };
  });
  if (new Set(normalized.map((row) => row.id)).size !== normalized.length)
    throw Error("Native actor map row identities collide after normalization");
  return {
    value: Object.fromEntries(normalized.map((row) => [row.id, row.value])),
    declaration: {
      kind,
      policy: resolution.policy,
      provenance: resolution.provenance,
      scope: resolution.scope,
      rows: normalized.map(({ value, ...row }) => row),
      original: opaque.original,
      originalNormalizedEntries: opaque.entries,
      nativeRows: resolution.nativeRows,
      eventSchedulingAdmitted: false,
      nativeSpectatorEquivalent: false,
    },
  };
}
