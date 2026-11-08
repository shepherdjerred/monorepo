// Static character/skin namespaces behind opcode-756 auxiliary context IDs.
// Context resources are ordered candidates, not successful effect creations.
import { sha256 } from "./structural-comparison.mjs";
import { ownLatestStaticBytes } from "./latest-static-bytes.mjs";
import { assertLatestSelectedContextObservation } from "./latest-selected-context-observation.mjs";
export const EFFECT_CONTEXTS_PACKAGE_SHA =
  "d17f43afcb61be953f6f1441186b1d4956e019ec74e5160c571617f6263e5e87";
const ownedContexts = new WeakSet();
export const isLatestEffectContexts = (value) => ownedContexts.has(value);
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
function ascii(value) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 1024 ||
    /[^\x01-\x7f]/.test(value)
  )
    throw Error("A bounded nonempty ASCII character context is required");
  return value;
}
export function nativeCharacterEffectContextIdentity(name, skinId, namespace) {
  if (!uint(skinId))
    throw Error("An unsigned character context skin is required");
  let hash = 0;
  for (const text of [
    "[Character]",
    ascii(name),
    String(skinId),
    ascii(namespace),
  ])
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      hash =
        (Math.imul(hash, 0x1003f) + (c >= 65 && c <= 90 ? c + 32 : c)) >>> 0;
    }
  return hash;
}

export async function createLatestEffectContexts({
  profile,
  image,
  packageBytes,
  effectsManifestBytes,
  staticCatalog = null,
}) {
  packageBytes = ownLatestStaticBytes(packageBytes);
  effectsManifestBytes = ownLatestStaticBytes(effectsManifestBytes);
  if (image !== undefined) image = ownLatestStaticBytes(image);
  if (
    (staticCatalog === null &&
      (await sha256(packageBytes)) !== EFFECT_CONTEXTS_PACKAGE_SHA) ||
    (image !== undefined &&
      (await sha256(image)) !== profile.decoderImageSha256)
  )
    throw Error("Pinned effect context package/image required");
  const parse = (b) =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)),
    meta = parse(packageBytes),
    effects = parse(effectsManifestBytes);
  if (staticCatalog !== null)
    await assertLatestSelectedContextObservation({
      selection: staticCatalog,
      profile,
      image,
      packageBytes,
      metadata: meta,
    });
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-character-effect-contexts" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    effects.build !== meta.build ||
    effects.protocol !== meta.protocol ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.effectsManifestSha256 !== (await sha256(effectsManifestBytes)) ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    meta.scope.fullMatchRegistryReconstructed ||
    meta.scope.fullResourcePrecedenceVerified
  )
    throw Error("Unsupported character context build/contract");
  for (const b of image === undefined ? [] : meta.sourceBlocks)
    if ((await sha256(image.subarray(b.rva, b.rva + b.size))) !== b.sha256)
      throw Error("Original context identity/registry instructions changed");
  const contexts = new Map();
  for (const c of meta.contexts) {
    const actor = effects.actors[c.actorKey];
    if (
      !actor ||
      contexts.has(c.identity) ||
      actor.character !== c.name ||
      actor.skinId !== c.skinId ||
      actor.resourceResolverId !== c.resourceResolverId ||
      c.namespace !== "characters" ||
      nativeCharacterEffectContextIdentity(c.name, c.skinId, c.namespace) !==
        c.identity
    )
      throw Error("Static character context identity/asset mismatch");
    contexts.set(c.identity, Object.freeze({ ...c }));
  }
  if (contexts.size !== Object.keys(effects.actors).length)
    throw Error("Static character context inventory incomplete");
  const lookup = (identity) => {
    if (!uint(identity))
      throw Error("An unsigned auxiliary context ID is required");
    const context = contexts.get(identity);
    // The native registry has a default entry for a missing key. Other live
    // contexts may exist outside this prepared catalog, so do not silently
    // substitute that default when an ID is unknown to this inventory.
    return context
      ? { status: "prepared-character-context", ...context }
      : { status: "unprepared-context-id", identity };
  };
  function candidates(ids, resourceKey) {
    if (
      !Array.isArray(ids) ||
      ids.length > 4096 ||
      !ids.every(uint) ||
      !uint(resourceKey)
    )
      throw Error("Bounded auxiliary context vector and resource key required");
    return ids.map((identity, index) => {
      const context = lookup(identity);
      if (context.status !== "prepared-character-context")
        return { index, ...context };
      if (resourceKey === 0)
        return {
          index,
          ...context,
          resourceStatus: "alternate-name-unresolved",
        };
      const ref =
        effects.actors[context.actorKey].resources[
          resourceKey.toString(16).padStart(8, "0")
        ];
      if (!ref)
        return { index, ...context, resourceStatus: "key-absent-from-context" };
      if (
        ref.status === "prepared-definition" &&
        !effects.definitions[ref.effectId]
      )
        throw Error("Context candidate references an absent definition");
      return {
        index,
        ...context,
        resourceStatus: ref.status,
        resource: structuredClone(ref),
      };
    });
  }
  const api = {
    metadata: meta,
    lookup,
    candidates,
    bindRequests(report) {
      if (
        report.build !== meta.build ||
        report.protocol !== meta.protocol ||
        !Array.isArray(report.effectDescriptors) ||
        !Array.isArray(report.effectCreations) ||
        report.effectDescriptors.length !== report.effectCreations.length
      )
        throw Error(
          "Matching complete effect descriptors required for context binding",
        );
      return report.effectDescriptors.map((descriptor, index) => {
        if (
          descriptor.creationSequence !== index ||
          descriptor.resourceKey !==
            report.effectCreations[index].resourceKey ||
          descriptor.entityId !== report.effectCreations[index].entityId
        )
          throw Error("Effect descriptor/context request identity differs");
        const ordered = candidates(
          descriptor.unresolvedAuxiliaryContextIds,
          descriptor.resourceKey,
        );
        return Object.freeze({
          creationSequence: index,
          entityId: descriptor.entityId,
          orderedAuxiliaryCandidates: ordered,
          allAuxiliaryContextsPrepared: ordered.every(
            (v) => v.status === "prepared-character-context",
          ),
          resourcePrecedenceVerified: false,
          factoryExecuted: false,
        });
      });
    },
  };
  ownedContexts.add(api);
  return api;
}

export function summarizeEffectContextRequests(requests) {
  if (!Array.isArray(requests))
    throw Error("Bound effect context requests required");
  const summary = {
    creationRequests: requests.length,
    auxiliaryReferences: 0,
    preparedReferences: 0,
    allContextsPreparedRequests: 0,
    requestsWithPreparedResourceCandidate: 0,
    unknownContextIds: {},
  };
  for (const request of requests) {
    if (
      !Array.isArray(request.orderedAuxiliaryCandidates) ||
      request.resourcePrecedenceVerified !== false ||
      request.factoryExecuted !== false
    )
      throw Error("Unverified context resource candidates required");
    if (request.allAuxiliaryContextsPrepared)
      summary.allContextsPreparedRequests++;
    let hasCandidate = false;
    for (const c of request.orderedAuxiliaryCandidates) {
      summary.auxiliaryReferences++;
      if (c.status === "prepared-character-context")
        summary.preparedReferences++;
      else if (c.status === "unprepared-context-id")
        summary.unknownContextIds[c.identity] =
          (summary.unknownContextIds[c.identity] ?? 0) + 1;
      else throw Error("Unknown effect context binding status");
      if (c.resourceStatus === "prepared-definition") hasCandidate = true;
    }
    if (hasCandidate) summary.requestsWithPreparedResourceCandidate++;
  }
  return summary;
}
