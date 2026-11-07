// Static complete system assets. Runtime/resource/renderer admission is separate.
import { sha256 } from "./structural-comparison.mjs";
import { createLatestVfxAssetInventory } from "./latest-vfx-assets.mjs";

export const VFX_SYSTEM_ASSETS_PACKAGE_SHA =
  "2628954d9d881ea1fbfd2be7f24a923337b2efbc634ab259173963ca26843554";

function unhex(value, length = null) {
  if (
    typeof value !== "string" ||
    !/^(?:[0-9a-f]{2})*$/.test(value) ||
    (length !== null && value.length !== length * 2)
  )
    throw Error("Malformed complete-system asset bytes");
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

export async function createLatestVfxSystemAssetInventory(
  profile,
  packageBytes,
  effectsBytes,
  nativeAssetBytes,
) {
  if ((await sha256(packageBytes)) !== VFX_SYSTEM_ASSETS_PACKAGE_SHA)
    throw Error("Pinned complete-system asset package required");
  const meta = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
    ),
    effects = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(effectsBytes),
    ),
    types = await createLatestVfxAssetInventory(profile, nativeAssetBytes);
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-complete-vfx-system-assets" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.constructorImageSha256 !== profile.constructorImageSha256 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.nativeAssetInventorySha256 !== profile.vfxAssetsSha256 ||
    meta.effectsManifestSha256 !== (await sha256(effectsBytes)) ||
    effects.build !== meta.build ||
    effects.protocol !== meta.protocol ||
    meta.rootType !== 0x45cd899f ||
    meta.rootBytes !== 0x160 ||
    meta.rootConstructorRva !== 0x1786e80 ||
    meta.fieldReaderRva !== 0x14bc830 ||
    meta.postloadRva !== 0x14bc490 ||
    types.typeInfo(meta.rootType).size !== 0x160 ||
    !meta.scope.completeSerializedRoot ||
    !meta.scope.originalPostloadCallbacks ||
    !meta.scope.parentOverridesPreserved ||
    meta.scope.resourceAcquisitionExecuted ||
    meta.scope.runtimeFactoryExecuted ||
    meta.scope.mainViewerIntegrated ||
    meta.scope.browserRun ||
    meta.scope.leagueReferenceCompared ||
    Object.keys(meta.systems).length !== Object.keys(effects.definitions).length
  )
    throw Error("Unsupported complete-system asset contract");
  function reference(effectId) {
    const ref = meta.systems[effectId],
      effect = effects.definitions[effectId];
    if (
      !ref ||
      !effect ||
      ref.definitionSha256 !== effect.sha256 ||
      ref.file !== `graphs/${ref.sha256}.json`
    )
      throw Error("Effect outside matching complete-system asset inventory");
    return ref;
  }
  return {
    metadata: meta,
    inspectSystem(effectId) {
      return structuredClone(reference(effectId));
    },
    async bindSystem(effectId, effectBytes, graphBytes) {
      const ref = reference(effectId),
        expected = effects.definitions[effectId];
      if (
        (await sha256(effectBytes)) !== ref.definitionSha256 ||
        (await sha256(graphBytes)) !== ref.sha256 ||
        graphBytes.length !== ref.bytes
      )
        throw Error("Complete-system asset source changed");
      const sourceDefinition = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(effectBytes),
      ).definition;
      const graph = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(graphBytes),
        ),
        object = unhex(graph.objectHex, 0x160),
        heap = unhex(graph.heapHex);
      if (
        graph.schema !== 1 ||
        graph.build !== meta.build ||
        graph.protocol !== meta.protocol ||
        graph.phase !== "complete-system-native-postload" ||
        graph.rootType !== meta.rootType ||
        graph.rootBytes !== meta.rootBytes ||
        graph.effectId !== effectId ||
        !Number.isSafeInteger(graph.heapStart) ||
        graph.heapStart < 0x10400000 ||
        graph.heapStart % 16 !== 0 ||
        graph.heapStart + heap.length > 0x12000000 ||
        heap.length !== ref.heapBytes ||
        (await sha256(object)) !== ref.rootSha256 ||
        (await sha256(heap)) !== ref.heapSha256 ||
        graph.pendingLinkFixups !== ref.pendingLinkFixups ||
        graph.pendingLinkFixups !== 0 ||
        graph.ignored.length !== 0 ||
        graph.mismatched.length !== 0 ||
        graph.mathCalls.length !== 0 ||
        graph.visits.length !== ref.visits ||
        graph.visits[0]?.type !== meta.rootType ||
        graph.visits[0]?.object !== 0x10020000
      )
        throw Error("Incomplete or unsupported native system asset state");
      const visits = new Map();
      for (const visit of graph.visits) {
        const type = types.typeInfo(visit.type);
        if (
          !Number.isSafeInteger(visit.object) ||
          visit.bytes !== type.size ||
          !(
            (visit.object >= 0x10020000 &&
              visit.object + visit.bytes <= 0x10020160) ||
            (visit.object >= graph.heapStart &&
              visit.object + visit.bytes <= graph.heapStart + heap.length)
          ) ||
          (visit.callbackRva !== null &&
            (!Number.isSafeInteger(visit.callbackRva) ||
              visit.callbackRva < 0x9000 ||
              visit.callbackRva >= 0x1fee0c6))
        )
          throw Error(
            "Complete-system post-load visit escaped owned typed objects/code",
          );
        if (!visits.has(visit.object)) visits.set(visit.object, []);
        visits.get(visit.object).push(visit);
      }
      const view = new DataView(object.buffer),
        heapView = new DataView(heap.buffer);
      function emitterList(at, expectedCount) {
        const pointer = view.getBigUint64(at, true),
          count = view.getUint32(at + 8, true),
          capacity = view.getUint32(at + 12, true),
          offset = pointer - BigInt(graph.heapStart);
        if (
          count !== expectedCount ||
          capacity < count ||
          (count > 0 &&
            (offset < 0n ||
              offset % 8n !== 0n ||
              offset + BigInt(count) * 8n > BigInt(heap.length)))
        )
          throw Error("Complete-system emitter list differs from source");
        return Array.from({ length: count }, (_, index) => {
          const address = heapView.getBigUint64(
              Number(offset) + index * 8,
              true,
            ),
            start = address - BigInt(graph.heapStart),
            number = Number(address);
          if (
            start < 0n ||
            start + 0x470n > BigInt(heap.length) ||
            !visits
              .get(number)
              ?.some(
                (visit) => visit.type === 0x09cde442 && visit.bytes === 0x470,
              )
          )
            throw Error(
              "Complete-system emitter pointer escaped typed asset heap",
            );
          return {
            index,
            address: number,
            object: heap.subarray(Number(start), Number(start) + 0x470),
          };
        });
      }
      const complexEmitters = emitterList(0x20, expected.complexEmitters),
        simpleEmitters = emitterList(
          0x30,
          Object.hasOwn(sourceDefinition, "simpleEmitterDefinitionData")
            ? sourceDefinition.simpleEmitterDefinitionData.length
            : 0,
        );
      return {
        effectId,
        rootType: meta.rootType,
        phase: graph.phase,
        object,
        heap,
        heapStart: graph.heapStart,
        complexEmitters,
        simpleEmitters,
        visits: structuredClone(graph.visits),
        completeSerializedRoot: true,
        parentOverridesPreserved: true,
        resourceAcquisitionExecuted: false,
        runtimeFactoryExecuted: false,
      };
    },
  };
}
