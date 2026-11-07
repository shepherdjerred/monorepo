import { sha256 } from "./structural-comparison.mjs";
import { createLatestVfxAssetInventory } from "./latest-vfx-assets.mjs";

function bytes(value, size = null) {
  if (
    typeof value !== "string" ||
    !/^(?:[0-9a-f]{2})*$/.test(value) ||
    (size !== null && value.length !== size * 2)
  )
    throw Error("Malformed native post-load bytes");
  return Uint8Array.from(value.match(/../g) ?? [], (v) => parseInt(v, 16));
}

// Offline execution output of the original recursive walker. This binder
// checks provenance and object ownership; it does not acquire GPU resources.
export async function createLatestVfxPostloadInventory(
  profile,
  definitionBytes,
  assetDefinitionBytes,
) {
  if ((await sha256(definitionBytes)) !== profile.vfxPostloadSha256)
    throw Error("Native post-load inventory hash mismatch");
  const meta = JSON.parse(new TextDecoder().decode(definitionBytes)),
    assets = await createLatestVfxAssetInventory(profile, assetDefinitionBytes);
  if (
    meta.schema !== 1 ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.vfxAssetsSha256 !== (await sha256(assetDefinitionBytes)) ||
    meta.postloadRva !== 0x14bc490
  )
    throw Error("Unsupported native post-load package");
  function reference(effectId, emitterIndex) {
    const serialized = assets.inspectEmitter(effectId, emitterIndex),
      ref = meta.emitters[`${effectId}:${emitterIndex}`];
    if (
      !ref ||
      ref.effectId !== effectId ||
      ref.emitterIndex !== emitterIndex ||
      ref.definitionSha256 !== serialized.definitionSha256 ||
      ref.serializedGraphSha256 !== serialized.sha256 ||
      ref.file !== `vfx-postload-graphs/${ref.sha256}.json`
    )
      throw Error("Emitter outside matching post-load inventory");
    return ref;
  }
  return {
    summary: structuredClone(meta.summary),
    inspectEmitter(effectId, emitterIndex) {
      return structuredClone(reference(effectId, emitterIndex));
    },
    async bindEmitter(
      effectId,
      emitterIndex,
      effectBytes,
      serializedGraphBytes,
      graphBytes,
    ) {
      const ref = reference(effectId, emitterIndex),
        before = await assets.bindEmitter(
          effectId,
          emitterIndex,
          effectBytes,
          serializedGraphBytes,
        );
      if (
        (await sha256(graphBytes)) !== ref.sha256 ||
        graphBytes.byteLength !== ref.bytes
      )
        throw Error("Native post-load state hash mismatch");
      const graph = JSON.parse(new TextDecoder().decode(graphBytes)),
        object = bytes(graph.objectHex, 0x470),
        heap = bytes(graph.heapHex);
      if (
        graph.schema !== 1 ||
        graph.build !== meta.build ||
        graph.protocol !== meta.protocol ||
        graph.phase !== "native-postload-callbacks-executed" ||
        graph.heapStart !== before.heapStart ||
        heap.length !== ref.heapBytes ||
        heap.length < before.heap.length ||
        graph.heapStart + heap.length > 0x12000000 ||
        !Array.isArray(graph.visits) ||
        graph.visits.length !== ref.visits ||
        !Array.isArray(graph.mathCalls) ||
        graph.mathCalls.length !== 0 ||
        graph.pendingLinkFixups !== ref.pendingLinkFixups ||
        graph.pendingLinkFixups !== 0
      )
        throw Error("Unsupported native post-load state");
      const root = graph.visits[0];
      if (root?.type !== 0x09cde442 || root.object !== 0x10020000)
        throw Error("Post-load root visit missing");
      for (const visit of graph.visits) {
        const type = assets.typeInfo(visit.type);
        if (
          !Number.isSafeInteger(visit.object) ||
          visit.bytes !== type.size ||
          !(
            (visit.object >= 0x10020000 &&
              visit.object + visit.bytes <= 0x10020470) ||
            (visit.object >= graph.heapStart &&
              visit.object + visit.bytes <= graph.heapStart + heap.length)
          ) ||
          (visit.callbackRva !== null &&
            (!Number.isSafeInteger(visit.callbackRva) ||
              visit.callbackRva < 0x9000 ||
              visit.callbackRva >= 0x1fee0c6))
        )
          throw Error("Post-load visit outside owned typed objects/code");
      }
      let changedBytes = heap.length - before.heap.length;
      for (let i = 0; i < object.length; i++)
        changedBytes += object[i] !== before.object[i];
      for (let i = 0; i < before.heap.length; i++)
        changedBytes += heap[i] !== before.heap[i];
      if (changedBytes !== ref.changedBytes)
        throw Error("Post-load mutation count disagrees");
      return {
        phase: graph.phase,
        object,
        heap,
        heapStart: graph.heapStart,
        visits: structuredClone(graph.visits),
        changedBytes,
        addedHeapBytes: heap.length - before.heap.length,
        pendingLinkFixups: graph.pendingLinkFixups,
      };
    },
  };
}
