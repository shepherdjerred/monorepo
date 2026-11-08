import { sha256 } from "./structural-comparison.mjs";

function bytes(value, size = null) {
  if (
    typeof value !== "string" ||
    !/^(?:[0-9a-f]{2})*$/.test(value) ||
    (size !== null && value.length !== size * 2)
  )
    throw Error("Malformed native asset state bytes");
  return Uint8Array.from(value.match(/../g) ?? [], (v) => parseInt(v, 16));
}

// Static output of the original serialized-property reader. Curve post-load,
// resource binding and runtime rendering admission are separate operations.
export async function createLatestVfxAssetInventory(profile, definitionBytes) {
  if ((await sha256(definitionBytes)) !== profile.vfxAssetsSha256)
    throw Error("Native asset inventory hash mismatch");
  const meta = JSON.parse(new TextDecoder().decode(definitionBytes));
  if (
    meta.schema !== 1 ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.registrationRva !== 0x17ac9a0 ||
    meta.fieldReaderRva !== 0x14bc830 ||
    meta.dispatchRva !== 0x14b57a0 ||
    meta.emitterClass !== 0x09cde442 ||
    meta.types["09cde442"]?.size !== 0x470 ||
    meta.types["09cde442"].properties.length !== 135
  )
    throw Error("Unsupported original VFX asset schema");
  function reference(effectId, emitterIndex) {
    if (
      typeof effectId !== "string" ||
      !Number.isSafeInteger(emitterIndex) ||
      emitterIndex < 0
    )
      throw Error("Invalid native emitter asset identity");
    const ref = meta.emitters[`${effectId}:${emitterIndex}`];
    if (!ref) throw Error("Emitter outside prepared native asset inventory");
    return ref;
  }
  return {
    summary: structuredClone(meta.summary),
    typeInfo(identity) {
      if (!Number.isInteger(identity) || identity < 0 || identity > 0xffffffff)
        throw Error("Invalid native type identity");
      const type = meta.types[identity.toString(16).padStart(8, "0")];
      if (!type) throw Error("Type outside prepared VFX registry");
      return structuredClone(type);
    },
    inspectEmitter(effectId, emitterIndex) {
      return structuredClone(reference(effectId, emitterIndex));
    },
    async bindEmitter(effectId, emitterIndex, effectBytes, graphBytes) {
      const ref = reference(effectId, emitterIndex);
      if (
        (await sha256(effectBytes)) !== ref.definitionSha256 ||
        (await sha256(graphBytes)) !== ref.sha256
      )
        throw Error("Native emitter asset source mismatch");
      const graph = JSON.parse(new TextDecoder().decode(graphBytes));
      if (
        graph.schema !== 1 ||
        graph.build !== meta.build ||
        graph.protocol !== meta.protocol ||
        graph.phase !== "serialized-fields-before-postload" ||
        !Number.isSafeInteger(graph.heapStart) ||
        graph.heapStart < 0x10400000 ||
        graph.heapStart > 0x12000000 ||
        graph.heapHex.length / 2 !== ref.heapBytes ||
        graph.heapStart + ref.heapBytes > 0x12000000 ||
        JSON.stringify(graph.ignored) !==
          JSON.stringify(ref.nativeIgnoredFields) ||
        JSON.stringify(graph.mismatched) !==
          JSON.stringify(ref.nativeTypeMismatches)
      )
        throw Error("Unsupported native emitter asset state");
      return {
        phase: graph.phase,
        status: ref.status,
        object: bytes(graph.objectHex, 0x470),
        heap: bytes(graph.heapHex),
        heapStart: graph.heapStart,
        fields: structuredClone(ref.fields),
        ignored: structuredClone(graph.ignored),
        mismatched: structuredClone(graph.mismatched),
      };
    },
  };
}
