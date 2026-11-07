// Resource projection of original SpellDataResource post-load898709..8987a3.
// Complete preceding producer history and VFX asset registration are separate
// requirements; this partial producer never makes an actual global stack ready.
import { mergeNativeResourceRows } from "./latest-map-effect-resources.mjs";

export function projectSpellResourcePublication(
  initial,
  sources,
  sourceEventId,
) {
  if (
    !initial ||
    typeof initial.componentPublished !== "boolean" ||
    !Array.isArray(initial.rows) ||
    !Array.isArray(initial.sources) ||
    initial.sources.length > 65536 ||
    !Array.isArray(sources) ||
    sources.length > 4096 ||
    typeof sourceEventId !== "string" ||
    !/^[A-Za-z0-9:/_.-]{1,256}$/.test(sourceEventId)
  )
    throw Error("Explicit bounded original resource producer inputs required");
  let rows = mergeNativeResourceRows([initial.rows]);
  if (
    initial.sources.some(
      (source) =>
        !source ||
        typeof source.sourceEventId !== "string" ||
        !/^[A-Za-z0-9:/_.-]{1,256}$/.test(source.sourceEventId) ||
        !Number.isInteger(source.index) ||
        source.index < 0 ||
        source.index >= 4096 ||
        typeof source.resourceId !== "string" ||
        !/^[A-Za-z0-9:/_.-]{1,256}$/.test(source.resourceId),
    )
  )
    throw Error("Exact preceding producer source identities required");
  const events = initial.sources.map((source) => structuredClone(source));
  const identities = new Set(
    events.map((source) => `${source.sourceEventId}:${source.index}`),
  );
  if (
    identities.size !== events.length ||
    events.length + sources.length > 65536
  )
    throw Error("Bounded unique producer source identities required");
  let published = initial.componentPublished;
  for (const [index, source] of sources.entries()) {
    if (
      !source ||
      source.status !== "supplied-resolved-resource-link" ||
      typeof source.id !== "string" ||
      !/^[A-Za-z0-9:/_.-]{1,256}$/.test(source.id)
    )
      throw Error("Original typed resource link resolution is required");
    const identity = `${sourceEventId}:${index}`;
    if (identities.has(identity))
      throw Error("Duplicate resource producer event identity");
    identities.add(identity);
    rows = mergeNativeResourceRows([rows, source.rows]);
    published = true;
    events.push(
      Object.freeze({
        sourceEventId,
        index,
        resourceId: source.id,
        originalMergeRva: 0x16154a0,
        originalPublicationRva: 0x89dbd0,
      }),
    );
  }
  return Object.freeze({
    rows,
    componentPublished: published,
    sources: Object.freeze(events.map((row) => Object.freeze(row))),
    status: "partial-original-spell-resource-publication",
    actualReplayCollectionContentsRecovered: false,
    priorGlobalProducerHistoryRecovered: false,
    assetRegistrationEstablished: false,
    originalRange: Object.freeze([0x898709, 0x8987a3]),
    omissions: Object.freeze([
      "resource:preceding-global0-producer-history-unrecovered",
      "resource:mode-and-indexed-asset-producers-not-reconstructed",
      "resource:original1615960-nonnull-vfx-asset-registration-unverified",
      "resource:actual-guest-overlays-and-registered-global-map-history-unrecovered",
    ]),
  });
}
