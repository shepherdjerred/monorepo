import { assertDirectCompiledDataGraph } from "./latest-direct-compiled-restore.mjs";
const need = (condition, message) => {
  if (!condition) throw Error(message);
};
const hexBytes = (value) => {
  need(
    typeof value === "string" && /^(?:[a-f0-9]{2})+$/.test(value),
    "Exact native color graph bytes required",
  );
  return Uint8Array.fromHex(value);
};
export function deriveSelectedParticleColorEntry({
  reference,
  graph,
  emitter,
  asset,
}) {
  assertDirectCompiledDataGraph({ reference, graph, emitter, asset });
  const object = hexBytes(graph.assetObjectHex),
    view = new DataView(object.buffer);
  need(
    object.length >= 0xb8 && graph.addresses?.definition === 0x10020000,
    "Original color emitter object layout required",
  );
  const pixelated = Object.hasOwn(emitter, "isTexturePixelated")
    ? emitter.isTexturePixelated
    : false;
  need(
    typeof pixelated === "boolean" && object[0x12] === Number(pixelated),
    "Serialized isTexturePixelated byte differs from authored source",
  );
  const path = emitter.particleColorTexture,
    encoded = new TextEncoder().encode(path);
  need(
    typeof path === "string" &&
      path.length > 0 &&
      path.length <= 4096 &&
      !path.includes("\0") &&
      view.getUint32(0xb0, true) === encoded.length,
    "Original color source string length differs",
  );
  const pointer = Number(view.getBigUint64(0xa8, true));
  need(
    Number.isSafeInteger(pointer),
    "Bounded original color string pointer required",
  );
  const segments = graph.segments.map((s) => ({
    address: s.address,
    bytes: hexBytes(s.bytesHex),
  }));
  const owned = segments.filter(
    (s) =>
      Number.isSafeInteger(s.address) &&
      pointer >= s.address &&
      pointer + encoded.length <= s.address + s.bytes.length,
  );
  need(
    owned.length === 1 &&
      owned[0].bytes
        .subarray(
          pointer - owned[0].address,
          pointer - owned[0].address + encoded.length,
        )
        .every((v, i) => v === encoded[i]),
    "Native color graph string differs from exact authored source",
  );
  const roots = segments.filter(
    (s) =>
      graph.addresses.definition >= s.address &&
      graph.addresses.definition + object.length <= s.address + s.bytes.length,
  );
  need(
    roots.length === 1 &&
      roots[0].bytes
        .subarray(
          graph.addresses.definition - roots[0].address,
          graph.addresses.definition - roots[0].address + object.length,
        )
        .every((v, i) => v === object[i]),
    "Complete unchanged color emitter bytes required",
  );
  need(
    asset?.kind === "texture" && asset.status === "prepared",
    "Prepared authored color texture required",
  );
  // Original16e39f1 forces the first3 lanes to1 for slot1;16e39c7
  // reads emitter+12 and XORs1 into both address lanes. No texture acquisition.
  const wrap = object[0x12] ^ 1;
  return {
    effectId: reference.effectId,
    emitterIndex: reference.emitterIndex,
    graphSha256: reference.sha256,
    sourceDefinitionSha256: reference.sourceDefinitionSha256,
    primitiveKind: reference.primitiveKind,
    authoredPath: path,
    nativeSlot: 1,
    nativeName: "PARTICLE_COLOR_TEXTURE",
    descriptorHex: `0101010${wrap}0${wrap}`,
    asset: Object.fromEntries(
      ["file", "sha256", "sourceSha256", "width", "height"].map((k) => [
        k,
        asset[k],
      ]),
    ),
  };
}
