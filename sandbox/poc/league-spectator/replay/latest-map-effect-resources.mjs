// Authored map/guest resources and original global lookup order. Catalog
// candidates do not establish a match's active globals or successful effects.
import { sha256 } from "./structural-comparison.mjs";
export const MAP_EFFECT_RESOURCES_SHA =
  "e224281c81fc7c8c0d0e1585dd5223b359ccb5edcb3d5bb5744b42c9b6a4262e";
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff,
  freeze = (v) => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  };
function rows(value) {
  if (
    !Array.isArray(value) ||
    value.length > 65536 ||
    value.some(
      (r, i) =>
        !r ||
        !uint(r.key) ||
        !uint(r.referenceToken) ||
        (i && value[i - 1].key > r.key),
    )
  )
    throw Error("Sorted unsigned resource keys/reference tokens required");
  return value;
}
export function lookupNativeResourceRows(value, key) {
  rows(value);
  if (!uint(key)) throw Error("Unsigned resource lookup key required");
  let lo = 0,
    hi = value.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (value[mid].key < key) lo = mid + 1;
    else hi = mid;
  }
  return lo < value.length && value[lo].key === key
    ? value[lo].referenceToken
    : undefined;
}
export function mergeNativeResourceRows(sources) {
  if (!Array.isArray(sources) || sources.length > 64)
    throw Error("Bounded resource map merge required");
  let total = 0;
  for (const source of sources) {
    total += rows(source).length;
    if (total > 65536) throw Error("Merged resource map exceeds native bound");
  }
  const result = sources.flatMap((source) => source.map((r) => ({ ...r })));
  return freeze(result.sort((a, b) => a.key - b.key));
}
export function selectSuppliedGlobalResourceMaps(
  { first, second, registered },
  key,
) {
  if (!uint(key)) throw Error("Unsigned global resource key required");
  const queried = [];
  function query(map, stage) {
    if (map === null) return null;
    if (
      !map ||
      typeof map.id !== "string" ||
      !/^[a-zA-Z0-9:/_.-]{1,256}$/.test(map.id)
    )
      throw Error("Explicit resource map ID/rows or null required");
    const value = lookupNativeResourceRows(map.rows, key);
    queried.push({ mapId: map.id, stage, matched: value !== undefined });
    return value === undefined
      ? null
      : freeze({
          status: "matched-authored-reference",
          resourceKey: key,
          mapId: map.id,
          referenceToken: value,
          stage,
          queried,
          liveMatchWorldVerified: false,
        });
  }
  for (const [globalIndex, group] of [first, second].entries()) {
    if (group === null) continue;
    if (group?.status === "unresolved-global-resource-stack")
      return freeze({
        status: group.status,
        globalIndex,
        resourceKey: key,
        queried,
      });
    if (
      group?.status !== "supplied-global-resource-stack" ||
      !Array.isArray(group.overlays) ||
      group.overlays.length > 64
    )
      throw Error(
        "Explicit supplied or unresolved global resource stack required",
      );
    for (let i = group.overlays.length - 1; i >= 0; i--) {
      const result = query(group.overlays[i], {
        kind: "global-overlay",
        globalIndex,
        overlayIndex: i,
      });
      if (result) return result;
    }
    const result = query(group.base, { kind: "global-base", globalIndex });
    if (result) return result;
  }
  if (registered?.status === "unresolved-registered-resource-maps")
    return freeze({ status: registered.status, resourceKey: key, queried });
  if (
    registered?.status !== "supplied-registered-resource-maps" ||
    !Array.isArray(registered.maps) ||
    registered.maps.length > 64
  )
    throw Error(
      "Explicit supplied or unresolved registered resource maps required",
    );
  for (const [index, map] of registered.maps.entries()) {
    if (map === null) throw Error("Registered resource map cannot be null");
    const result = query(map, { kind: "registered-global", index });
    if (result) return result;
  }
  return freeze({
    status: "key-absent",
    resourceKey: key,
    queried,
    liveMatchWorldVerified: false,
  });
}

export async function createLatestMapEffectResources({
  profile,
  packageBytes,
}) {
  if ((await sha256(packageBytes)) !== MAP_EFFECT_RESOURCES_SHA)
    throw Error("Pinned map effect resource contract required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-map-effect-resource-contract" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.mapId !== 12 ||
    meta.merge !==
      "append-then-stable-sort-by-unsigned-key-keeping-duplicates" ||
    meta.lookup !== "first-equal-key-in-sorted-array-including-null" ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    meta.scope.containsUnitInstances ||
    !meta.scope.originalTypedMapsAndStableMergesObserved ||
    !meta.scope.completeGlobalResolverObserved ||
    !meta.scope.suppliedGlobalStacks ||
    !meta.scope.resolverValuesAreReferenceTokens ||
    meta.scope.activeMapVariantRecovered ||
    meta.scope.activeGuestRecovered ||
    meta.scope.externalLinksResolved ||
    meta.scope.completeFactoryPrecedenceVerified ||
    meta.scope.worldFactoryExecuted
  )
    throw Error("Unsupported map resource build/contract");
  for (const map of Object.values(meta.maps)) rows(map.rows);
  const handle = (id) => {
    if (id === null) return null;
    if (typeof id !== "string" || !Object.hasOwn(meta.maps, id))
      throw Error("Unknown authored map resource ID");
    return { id, rows: meta.maps[id].rows };
  };
  const merged = new Map(
    Object.entries(meta.mapSkins).map(([id, skin]) => [
      id,
      mergeNativeResourceRows(skin.resolvers.map((id) => handle(id).rows)),
    ]),
  );
  const declaration = (token) => {
    const id = token.toString(16).padStart(8, "0"),
      ref = meta.definitionIndex[id];
    return ref
      ? { status: "map-effect-declaration", id, ...ref }
      : {
          status:
            token === 0
              ? "authored-null"
              : "reference-outside-map-declarations",
          id,
        };
  };
  freeze(meta);
  return Object.freeze({
    metadata: meta,
    lookupMap(id, key) {
      const map = handle(id);
      if (map === null) throw Error("Authored map ID required");
      const value = lookupNativeResourceRows(map.rows, key);
      return value === undefined
        ? freeze({ status: "key-absent", mapId: id, resourceKey: key })
        : freeze({
            status: "matched-authored-reference",
            mapId: id,
            resourceKey: key,
            referenceToken: value,
            declaration: declaration(value),
          });
    },
    mergedMapSkin(id) {
      if (!merged.has(id))
        throw Error("An explicit prepared map skin ID is required");
      return merged.get(id);
    },
    selectGlobals({ first, second, registered }, key) {
      const group = (g) =>
        g === null || g?.status === "unresolved-global-resource-stack"
          ? g
          : {
              status: g?.status,
              base: handle(g?.base),
              overlays: g?.overlays?.map(handle),
            };
      return selectSuppliedGlobalResourceMaps(
        {
          first: group(first),
          second: group(second),
          registered:
            registered?.status === "unresolved-registered-resource-maps"
              ? registered
              : {
                  status: registered?.status,
                  maps: registered?.maps?.map(handle),
                },
        },
        key,
      );
    },
    candidates(key) {
      if (!uint(key)) throw Error("Unsigned resource candidate key required");
      const matches = [];
      for (const [id, map] of Object.entries(meta.maps)) {
        const value = lookupNativeResourceRows(map.rows, key);
        if (value === undefined) continue;
        matches.push({
          mapId: id,
          referenceToken: value,
          declaration: declaration(value),
          mapSkins: Object.entries(meta.mapSkins)
            .filter(([, s]) => s.resolvers.includes(id))
            .map(([id, s]) => ({ id, name: s.name })),
          guests: Object.entries(meta.guests)
            .filter(([, g]) => g.resourceResolver === id)
            .map(([id, g]) => ({ id, name: g.name })),
        });
      }
      return freeze({
        status: "catalog-candidates",
        resourceKey: key,
        matches,
        activeMapVariantVerified: false,
        activeGuestVerified: false,
        unitPrecedenceVerified: false,
        factoryExecuted: false,
      });
    },
    async definitions(bytes) {
      if ((await sha256(bytes)) !== meta.definitions.sha256)
        throw Error("Pinned complete map effect declarations required");
      const all = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      if (Object.keys(all).length !== meta.definitions.count)
        throw Error("Map declaration count differs");
      for (const [id, value] of Object.entries(all))
        if (
          value.__type !== "VfxSystemDefinitionData" ||
          (await sha256(new TextEncoder().encode(JSON.stringify(value)))) !==
            meta.definitionIndex[id]?.sha256
        )
          throw Error("Map effect declaration identity differs");
      return freeze(all);
    },
  });
}
