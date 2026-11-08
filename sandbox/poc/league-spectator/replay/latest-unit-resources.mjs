// Selection over explicit runtime resource handles. This module does not infer
// a unit's live base/overlays from its champion or equipped skin.
import { sha256 } from "./structural-comparison.mjs";
import {
  EFFECT_RESOLVERS_PACKAGE_SHA,
  isLatestEffectResolvers,
} from "./latest-effect-resolvers.mjs";
import {
  assertSelectedFixedResourceProgram,
  assertSelectedResourceDependency,
} from "./latest-selected-resource-programs.mjs";
export const UNIT_RESOURCES_PACKAGE_SHA =
  "0a38ed00a544bde4021247235aef99637ff20909af1f0063aefb5eee8ff03063";
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const frozen = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const child of Object.values(v)) frozen(child);
    Object.freeze(v);
  }
  return v;
};
export async function createLatestUnitResources({
  profile,
  packageBytes,
  resolvers,
  staticCatalog = null,
}) {
  if ((await sha256(packageBytes)) !== UNIT_RESOURCES_PACKAGE_SHA)
    throw Error("Pinned unit resource precedence package required");
  if (staticCatalog !== null) {
    if (!isLatestEffectResolvers(resolvers))
      throw Error("Owned selected effect resolver required");
    await assertSelectedFixedResourceProgram({
      selection: staticCatalog,
      profile,
      role: "unitResources",
      packageBytes,
    });
    await assertSelectedResourceDependency(
      staticCatalog,
      "effectResolvers",
      resolvers.metadata,
    );
  }
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-unit-resource-precedence" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    meta.resolversPackageSha256 !== EFFECT_RESOLVERS_PACKAGE_SHA ||
    resolvers.metadata.build !== meta.build ||
    resolvers.metadata.protocol !== meta.protocol ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    meta.scope.containsUnitInstances ||
    !meta.scope.suppliedStackAlgorithmObserved ||
    meta.scope.liveMatchStacksRecovered ||
    meta.scope.globalResolutionVerified ||
    meta.scope.externalLinksResolved ||
    meta.scope.worldEffectFactoryExecuted ||
    !meta.presentNullIsMatch ||
    meta.overlayPush !== "remove-first-identical-handle-then-append"
  )
    throw Error("Unsupported unit resource precedence build/contract");
  const handle = (h) => {
    if (
      h !== null &&
      (!h ||
        typeof h.id !== "string" ||
        !/^[a-zA-Z0-9:/_.-]{1,256}$/.test(h.id) ||
        !uint(h.contextIdentity))
    )
      throw Error(
        "Explicit resource handle ID/context identity or null required",
      );
    return h;
  };
  const vector = (v) => {
    if (!Array.isArray(v) || v.length > 4096)
      throw Error("Bounded resource handle vector required");
    v.forEach(handle);
    return v;
  };
  const same = (a, b) => (a === null || b === null ? a === b : a.id === b.id);
  const consistent = (handles) => {
    const ids = new Map();
    for (const h of handles)
      if (h !== null) {
        if (ids.has(h.id) && ids.get(h.id) !== h.contextIdentity)
          throw Error("Resource handle identity changed within one selection");
        ids.set(h.id, h.contextIdentity);
      }
  };
  return Object.freeze({
    metadata: frozen(meta),
    pushOverlay(overlays, next) {
      vector(overlays);
      handle(next);
      consistent([...overlays, next]);
      const at = overlays.findIndex((v) => same(v, next));
      if (at < 0 && overlays.length === 4096)
        throw Error("Resource overlay vector exceeds its bound");
      const result = overlays.map((v) => (v === null ? null : { ...v }));
      if (at >= 0) result.splice(at, 1);
      result.push(next === null ? null : { ...next });
      return frozen(result);
    },
    selectSuppliedStacks({ units, auxiliaries }, key) {
      if (!uint(key) || !Array.isArray(units) || units.length > 64)
        throw Error(
          "Unsigned resource key and bounded explicit unit stacks required",
        );
      vector(auxiliaries);
      const allHandles = [...auxiliaries];
      for (const unit of units) {
        if (unit?.status === "unresolved-unit-resource-stack") {
          if (!uint(unit.entityId))
            throw Error("Unresolved resource stack needs an entity ID");
        } else if (unit?.status === "supplied-resource-stack") {
          handle(unit.base);
          vector(unit.overlays);
          allHandles.push(unit.base, ...unit.overlays);
        } else
          throw Error(
            "Explicit supplied or unresolved unit resource stack required",
          );
      }
      consistent(allHandles);
      if (key === 0)
        return frozen({
          status: "alternate-name-unresolved",
          resourceKey: key,
        });
      const query = (h, stage) => {
        if (h === null) return null;
        const result = resolvers.lookup(h.contextIdentity, key);
        return result.status === "key-absent"
          ? null
          : frozen({
              ...result,
              handleId: h.id,
              stage,
              resourceKey: key,
              liveMatchStackVerified: false,
            });
      };
      for (const [unitIndex, unit] of units.entries()) {
        if (unit.status === "unresolved-unit-resource-stack")
          return frozen({
            status: unit.status,
            entityId: unit.entityId,
            unitIndex,
            resourceKey: key,
          });
        for (let i = unit.overlays.length - 1; i >= 0; i--) {
          const result = query(unit.overlays[i], {
            kind: "unit-overlay",
            unitIndex,
            overlayIndex: i,
          });
          if (result) return result;
        }
        const result = query(unit.base, { kind: "unit-base", unitIndex });
        if (result) return result;
      }
      for (const [index, h] of auxiliaries.entries()) {
        const result = query(h, { kind: "auxiliary", index });
        if (result) return result;
      }
      return frozen({ status: "continue-global-resolution", resourceKey: key });
    },
  });
}
