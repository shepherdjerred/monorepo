// Authored auxiliary-stage selection. Values are reference tokens, not live VFX
// pointers. Unit-context precedence, global fallback and factory creation remain
// separate unresolved engine stages.
import { sha256 } from "./structural-comparison.mjs";
import { ownLatestStaticBytes } from "./latest-static-bytes.mjs";
import {
  EFFECT_CONTEXTS_PACKAGE_SHA,
  isLatestEffectContexts,
} from "./latest-effect-contexts.mjs";
import { createLatestBuiltinResourceContexts } from "./latest-builtin-resource-contexts.mjs";
import { EFFECT_RESOLVERS_PACKAGE_SHA } from "./latest-effect-resolver-contract.mjs";
export { EFFECT_RESOLVERS_PACKAGE_SHA } from "./latest-effect-resolver-contract.mjs";
import { assertSelectedResolverObservation } from "./latest-selected-resource-programs.mjs";
const ownedResolvers = new WeakSet();
export const isLatestEffectResolvers = (value) => ownedResolvers.has(value);
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const freeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
};
export async function createLatestEffectResolvers({
  profile,
  packageBytes,
  effectsManifestBytes,
  contexts,
  builtinContextPackageBytes,
  staticCatalog = null,
}) {
  packageBytes = ownLatestStaticBytes(packageBytes);
  effectsManifestBytes = ownLatestStaticBytes(effectsManifestBytes);
  builtinContextPackageBytes = ownLatestStaticBytes(builtinContextPackageBytes);
  const builtins = await createLatestBuiltinResourceContexts({
    profile,
    packageBytes: builtinContextPackageBytes,
  });
  if (
    staticCatalog === null &&
    (await sha256(packageBytes)) !== EFFECT_RESOLVERS_PACKAGE_SHA
  )
    throw Error("Pinned authored effect resolver package required");
  const parse = (b) =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)),
    meta = parse(packageBytes),
    effects = parse(effectsManifestBytes);
  if (staticCatalog !== null && !isLatestEffectContexts(contexts))
    throw Error("Owned selected effect contexts required");
  const expectedContextsSha =
    staticCatalog === null
      ? EFFECT_CONTEXTS_PACKAGE_SHA
      : await assertSelectedResolverObservation({
          selection: staticCatalog,
          profile,
          packageBytes,
          manifestBytes: effectsManifestBytes,
          contexts,
        });
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-authored-effect-resolvers" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    effects.build !== meta.build ||
    effects.protocol !== meta.protocol ||
    meta.effectsManifestSha256 !== (await sha256(effectsManifestBytes)) ||
    meta.contextsPackageSha256 !== expectedContextsSha ||
    contexts.metadata.build !== meta.build ||
    contexts.metadata.protocol !== meta.protocol ||
    contexts.metadata.effectsManifestSha256 !== meta.effectsManifestSha256 ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    meta.scope.externalLinksResolved ||
    meta.scope.unitResourcePrecedenceVerified ||
    meta.scope.globalResolutionVerified ||
    meta.scope.effectFactoryExecuted ||
    meta.lookup.order !== "first-present-key-in-vector-order" ||
    meta.lookup.nullReferenceIsPresent !== true
  )
    throw Error("Unsupported authored resolver build/contract");
  const maps = new Map();
  for (const actor of meta.actors) {
    const context = contexts.lookup(actor.contextIdentity),
      authored = effects.actors[actor.actorKey];
    if (
      maps.has(actor.contextIdentity) ||
      !authored ||
      context.status !== "prepared-character-context" ||
      context.actorKey !== actor.actorKey
    )
      throw Error("Resolver context/actor identity differs");
    if (actor.status === "no-authored-resource-resolver") {
      if (
        authored.resourceResolverId !== null ||
        actor.resourceResolverId !== null ||
        actor.rows.length ||
        Object.keys(authored.resources).length
      )
        throw Error("Absent authored resolver has entries");
    } else if (actor.status === "native-resource-map-loaded") {
      if (
        Number.parseInt(
          authored.resourceResolverId.replace(/[{}]/g, ""),
          16,
        ) !== actor.resourceResolverId ||
        actor.rows.length !== Object.keys(authored.resources).length
      )
        throw Error("Authored resolver identity/count differs");
      let previous = -1;
      for (const row of actor.rows) {
        const ref = authored.resources[row.key.toString(16).padStart(8, "0")];
        if (
          !uint(row.key) ||
          !uint(row.referenceToken) ||
          row.key <= previous ||
          !ref ||
          Number.parseInt(ref.reference.replace(/[{}]/g, ""), 16) !==
            row.referenceToken ||
          (ref.status === "prepared-definition" &&
            !effects.definitions[ref.effectId])
        )
          throw Error("Invalid authored resolver row");
        previous = row.key;
      }
    } else throw Error("Unknown authored resolver state");
    maps.set(actor.contextIdentity, freeze(actor));
  }
  if (maps.size !== Object.keys(effects.actors).length)
    throw Error("Incomplete authored resolver inventory");
  freeze(meta);
  function lookup(identity, key) {
    if (!uint(identity) || !uint(key))
      throw Error("Unsigned resolver context/key required");
    const builtin = builtins.lookup(identity);
    if (builtin)
      return freeze({
        ...builtin,
        status: "key-absent",
        reason: "built-in-context-resource-getter-returned-null",
      });
    const actor = maps.get(identity);
    if (!actor) return freeze({ status: "unprepared-context-id", identity });
    if (actor.status === "no-authored-resource-resolver")
      return freeze({
        status: "no-authored-resource-resolver",
        identity,
        actorKey: actor.actorKey,
      });
    // The native map uses an unsigned lower-bound search over sorted keys.
    let lo = 0,
      hi = actor.rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (actor.rows[mid].key < key) lo = mid + 1;
      else hi = mid;
    }
    const row = actor.rows[lo];
    if (!row || row.key !== key)
      return freeze({
        status: "key-absent",
        identity,
        actorKey: actor.actorKey,
      });
    const ref =
      effects.actors[actor.actorKey].resources[
        key.toString(16).padStart(8, "0")
      ];
    return freeze({
      status: "matched-authored-reference",
      identity,
      actorKey: actor.actorKey,
      referenceToken: row.referenceToken,
      resource: structuredClone(ref),
    });
  }
  function selectAuxiliary(ids, key) {
    if (
      !Array.isArray(ids) ||
      ids.length > 4096 ||
      !ids.every(uint) ||
      !uint(key)
    )
      throw Error("Bounded unsigned auxiliary vector/key required");
    // Key zero uses another factory name-resolution path; do not reinterpret it
    // as a miss or use a later stage's defaults.
    if (key === 0)
      return freeze({ status: "alternate-name-unresolved", resourceKey: key });
    for (const [index, identity] of ids.entries()) {
      const result = lookup(identity, key);
      if (result.status === "key-absent") continue;
      return freeze({ ...result, index, resourceKey: key });
    }
    return freeze({ status: "continue-global-resolution", resourceKey: key });
  }
  const api = {
    metadata: meta,
    lookup,
    selectAuxiliary,
    bindRequests(report) {
      // The context binder validates descriptor/creation identities first.
      const requests = contexts.bindRequests(report);
      return requests.map((request, i) =>
        freeze({
          creationSequence: request.creationSequence,
          entityId: request.entityId,
          auxiliary: selectAuxiliary(
            report.effectDescriptors[i].unresolvedAuxiliaryContextIds,
            report.effectDescriptors[i].resourceKey,
          ),
          unitResourcePrecedenceVerified: false,
          globalResolutionVerified: false,
          externalLinksResolved: false,
          factoryExecuted: false,
        }),
      );
    },
    bindTimeline(pipeline, report) {
      if (
        !pipeline.scope.requestLifecycleOnly ||
        pipeline.scope.nativeFactorySucceededInferred ||
        pipeline.summary.creationRequests !== report.effectCreations.length
      )
        throw Error("Matching canonical effect request timeline required");
      const requests = api.bindRequests(report);
      for (const [i, request] of requests.entries()) {
        const creation = pipeline.creation(i),
          descriptor = report.effectDescriptors[i];
        if (
          creation.entityId !== request.entityId ||
          creation.creationSequence !== i ||
          creation.time !== descriptor.time ||
          creation.transportSequence !== descriptor.transportSequence ||
          creation.descriptor.descriptorHex !== descriptor.descriptorHex
        )
          throw Error("Auxiliary selection/timeline request identity differs");
      }
      const creation = (index) => {
        const original = pipeline.creation(index);
        return freeze({ ...original, resourceStages: requests[index] });
      };
      return Object.freeze({
        ...pipeline,
        scope: freeze({
          ...pipeline.scope,
          auxiliaryReferenceSelection: true,
          completeResourceSelectionVerified: false,
        }),
        resourceSummary: freeze(summarizeEffectResolverRequests(requests)),
        creation,
        sampleEntity(entityId, time) {
          const sample = pipeline.sampleEntity(entityId, time);
          return sample
            ? freeze({
                ...sample,
                creation:
                  sample.creation === null
                    ? null
                    : creation(sample.state.creationSequence),
              })
            : null;
        },
      });
    },
  };
  Object.freeze(api);
  ownedResolvers.add(api);
  return api;
}

export function summarizeEffectResolverRequests(requests) {
  const summary = {
    creationRequests: requests.length,
    auxiliaryStages: {},
    selectedPreparedDefinitions: 0,
  };
  for (const request of requests) {
    if (
      request.unitResourcePrecedenceVerified !== false ||
      request.externalLinksResolved !== false ||
      request.factoryExecuted !== false ||
      request.globalResolutionVerified !== false
    )
      throw Error("Only bounded auxiliary-stage results can be summarized");
    const r = request.auxiliary;
    summary.auxiliaryStages[r.status] =
      (summary.auxiliaryStages[r.status] ?? 0) + 1;
    if (
      r.status === "matched-authored-reference" &&
      r.resource.status === "prepared-definition"
    )
      summary.selectedPreparedDefinitions++;
  }
  return summary;
}
