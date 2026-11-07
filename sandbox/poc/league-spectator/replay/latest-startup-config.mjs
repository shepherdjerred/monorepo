// Read recorded startup configuration after the original packet decoder runs.
// This establishes mode/map inputs, not the live unit resource stacks.
import { sha256 } from "./structural-comparison.mjs";
export const STARTUP_CONFIG_SHA =
  "b97e3531eef2f7e377babb320fbd89f865afe61376f0ee6510f68ccd50c3fde3";
const freeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
export async function createLatestStartupConfig({
  profile,
  image,
  packageBytes,
}) {
  if (
    !(image instanceof Uint8Array) ||
    !(packageBytes instanceof Uint8Array) ||
    (await sha256(packageBytes)) !== STARTUP_CONFIG_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned original startup configuration package/image required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-original-startup-config" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    profile.constructorImageSha256 !== meta.constructorImageSha256 ||
    profile.packets[728]?.entryRva !== meta.decoderRva ||
    meta.stream !== 3 ||
    meta.opcode !== 728 ||
    meta.objectSize !== 568 ||
    meta.arenaBase !== 0x10200000 ||
    meta.mapIdOffset !== 0x88 ||
    meta.modePointerOffset !== 0xb8 ||
    meta.modeLengthOffset !== 0xc0 ||
    meta.modeCapacityOffset !== 0xc4 ||
    meta.modeHash !== "casefold-ascii-fnv1a32" ||
    meta.tftSubsystem.modeKey !== 0xb8ffaf71 ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    meta.scope.containsConfiguredMode ||
    meta.scope.fullStartupHandlerExecuted ||
    meta.scope.liveResourceStacksRecovered ||
    meta.scope.effectFactoryExecuted
  )
    throw Error("Unsupported startup configuration build/contract");
  for (const b of meta.sourceBlocks)
    if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original startup configuration instructions changed");
  if (
    meta.mapIdCodec.length !== 4 ||
    meta.mapIdCodec.some(
      (c) =>
        c.length !== 256 ||
        new Set(c).size !== 256 ||
        c.some((v) => !Number.isInteger(v) || v < 0 || v > 255),
    )
  )
    throw Error("Invalid configured map field codecs");
  freeze(meta);
  function read(observation) {
    const { object, heap } = observation ?? {};
    if (
      !observation?.complete ||
      !(object instanceof Uint8Array) ||
      object.length !== 568 ||
      !(heap instanceof Uint8Array) ||
      heap.length < 568
    )
      throw Error("Complete original startup configuration packet required");
    const view = new DataView(
      object.buffer,
      object.byteOffset,
      object.byteLength,
    );
    if (
      view.getUint16(8, true) !== 728 ||
      view.getUint32(12, true) !== 0 ||
      object.some((v, i) => v !== heap[i])
    )
      throw Error("Startup packet identity/arena differs");
    const pointer = view.getBigUint64(meta.modePointerOffset, true),
      length = view.getUint32(meta.modeLengthOffset, true),
      capacity = view.getUint32(meta.modeCapacityOffset, true);
    if (pointer > BigInt(Number.MAX_SAFE_INTEGER))
      throw Error("Startup mode pointer exceeds supported arena");
    const at = Number(pointer) - meta.arenaBase;
    if (
      !Number.isSafeInteger(at) ||
      at < 568 ||
      length < 1 ||
      length > 128 ||
      capacity <= length ||
      at + capacity > heap.length ||
      heap[at + length] !== 0
    )
      throw Error("Startup mode string exceeds its decoded allocation");
    const mode = new TextDecoder("utf-8", { fatal: true }).decode(
      heap.subarray(at, at + length),
    );
    if (!/^[A-Za-z0-9_]+$/.test(mode))
      throw Error("Invalid recorded mode identifier");
    let modeHash = 0x811c9dc5,
      configuredMapId = 0;
    for (const c of new TextEncoder().encode(mode.toLowerCase()))
      modeHash = Math.imul(modeHash ^ c, 0x1000193) >>> 0;
    for (let lane = 0; lane < 4; lane++)
      configuredMapId +=
        meta.mapIdCodec[lane][object[meta.mapIdOffset + lane]] *
        2 ** (lane * 8);
    return Object.freeze({
      mode,
      modeHash,
      configuredMapId,
      tftResourceSubsystemSelected: modeHash === meta.tftSubsystem.modeKey,
      liveResourceStacksRecovered: false,
      fullStartupHandlerExecuted: false,
    });
  }
  return Object.freeze({ metadata: meta, read });
}
