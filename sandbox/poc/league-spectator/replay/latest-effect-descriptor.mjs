// Execute original packet-to-descriptor code, before resource/factory lookup.
import { NativeDecoder } from "./native-decoder.mjs";
import { sha256 } from "./structural-comparison.mjs";
import {
  createLatestEffectPlacementReader,
  EFFECT_PLACEMENT_PACKAGE_SHA,
} from "./latest-effect-placement.mjs";
import { EFFECT_CREATION_PACKAGE_SHA } from "./latest-effect-creation.mjs";
import { assertLatestSelectedEffectPacket } from "./latest-selected-effect-packets.mjs";
import { EFFECT_DESCRIPTOR_PACKAGE_SHA } from "./latest-effect-packet-contract.mjs";
export { EFFECT_DESCRIPTOR_PACKAGE_SHA } from "./latest-effect-packet-contract.mjs";

export async function createLatestEffectDescriptorReader({
  uc,
  profile,
  image,
  creationBytes,
  placementBytes,
  sceneBytes,
  descriptorBytes,
  staticCatalog = null,
}) {
  if (
    !(descriptorBytes instanceof Uint8Array) ||
    (staticCatalog === null &&
      (await sha256(descriptorBytes)) !== EFFECT_DESCRIPTOR_PACKAGE_SHA)
  )
    throw Error("Pinned effect-descriptor package required");
  if (staticCatalog !== null)
    await assertLatestSelectedEffectPacket({
      selection: staticCatalog,
      kind: "descriptor",
      profile,
      packageBytes: descriptorBytes,
      sceneBytes,
    });
  const meta = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(descriptorBytes),
    ),
    placement = await createLatestEffectPlacementReader(
      profile,
      image,
      creationBytes,
      placementBytes,
      sceneBytes,
      staticCatalog,
    );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-particle-creation-descriptor-prefix" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.constructorImageSha256 !== profile.constructorImageSha256 ||
    meta.sliceSha256 !== placement.metadata.sliceSha256 ||
    meta.creationPackageSha256 !== EFFECT_CREATION_PACKAGE_SHA ||
    meta.placementPackageSha256 !== EFFECT_PLACEMENT_PACKAGE_SHA ||
    meta.sceneManifestSha256 !== (await sha256(sceneBytes)) ||
    meta.entryAddress !== 0x100f1000 ||
    meta.groupAddress !== 0x100f2000 ||
    meta.frameAddress !== 0x100f5000 ||
    meta.prefixBlock.join(",") !== [0x84f530, 0x8501af].join(",") ||
    meta.descriptorFrameOffset !== -0x190 ||
    meta.descriptorBytes !== 0xc0 ||
    !meta.scope.entityPointersSuppliedZero ||
    !meta.scope.packetVectorInputsNative ||
    meta.scope.resourceLookupExecuted ||
    meta.scope.auxiliaryContextLookupExecuted ||
    meta.scope.worldRegistryExecuted ||
    meta.scope.factoryExecuted ||
    meta.scope.renderingIntegrated
  )
    throw Error("Unsupported effect-descriptor execution contract");
  for (const block of meta.sourceBlocks)
    if (
      (await sha256(image.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Original effect-descriptor instructions changed");
  const native = new NativeDecoder(uc, profile, image, {
      captureWrites: false,
    }),
    engine = native.engine,
    base = profile.imageBase,
    frame = meta.frameAddress,
    start = base + meta.prefixBlock[0],
    end = base + meta.prefixBlock[1];
  let active = false,
    closed = false;
  // The admitted prefix has no calls. Do not admit imports, world services or
  // a new code path merely because the rest of the image is mapped.
  engine.hook_add(
    uc.HOOK_BLOCK,
    (_engine, address) => {
      const at = Number(address);
      if (!active || at < start || at > end)
        throw Error("Descriptor execution escaped original prefix");
    },
    null,
    1,
    0,
  );
  engine.hook_add(
    uc.HOOK_MEM_WRITE,
    (_engine, _access, address, size) => {
      const at = Number(address);
      if (
        !active ||
        !(
          (at >= frame - 0x200 && at + size <= frame) ||
          (at >= meta.entryAddress && at + size <= meta.entryAddress + 0xb8)
        )
      )
        throw Error("Descriptor write escaped owned entry/frame");
    },
    null,
    1,
    0,
  );
  engine.hook_add(uc.HOOK_CODE, () => engine.emu_stop(), null, end, end);
  const floatBytes = (value) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    return bytes;
  };
  const floatBits = (value) =>
    new DataView(floatBytes(value).buffer).getUint32(0, true);
  function execute(group, entry, vectors) {
    engine.context_restore(native.context);
    engine.mem_write(meta.entryAddress, entry);
    engine.mem_write(meta.groupAddress, group);
    engine.mem_write(frame - 0x200, new Uint8Array(0x200));
    native.u64(frame - 0x38, meta.groupAddress);
    native.u64(frame - 0x40, meta.entryAddress);
    for (const [offset, value] of [
      [-0x50, vectors.primaryPacketPosition[0]],
      [-0xa4, vectors.primaryPacketPosition[2]],
      [-0x70, vectors.secondaryPacketVector[0]],
      [-0xa0, vectors.secondaryPacketVector[2]],
    ])
      engine.mem_write(frame + offset, floatBytes(value));
    engine.reg_write_i64(uc.X86_REG_RSP, 0x201ff008n);
    engine.reg_write_i64(uc.X86_REG_RBP, BigInt(frame));
    engine.reg_write_i64(
      uc.X86_REG_R15,
      BigInt(floatBits(vectors.primaryPacketPosition[1])),
    );
    engine.reg_write_i64(
      uc.X86_REG_R12,
      BigInt(floatBits(vectors.secondaryPacketVector[1])),
    );
    active = true;
    try {
      engine.emu_start(start, end, 0, 5000000);
      if (Number(engine.reg_read_i64(uc.X86_REG_RIP)) !== end)
        throw Error("Descriptor prefix instruction bound exceeded");
    } finally {
      active = false;
    }
    return {
      bytes: native.read(
        frame + meta.descriptorFrameOffset,
        meta.descriptorBytes,
      ),
      mutatedEntryBytes: native.read(meta.entryAddress, 0xb8),
    };
  }
  return {
    metadata: meta,
    read(observation) {
      if (closed) throw Error("Effect-descriptor reader is closed");
      const positions = placement.read(observation),
        heap = observation.heap,
        view = new DataView(heap.buffer, heap.byteOffset, heap.byteLength),
        gp = Number(view.getBigUint64(0x10, true)) - 0x10200000;
      return positions.map((position) => {
        const groupOffset = gp + position.groupIndex * 0x50,
          group = heap.subarray(groupOffset, groupOffset + 0x50),
          ep = Number(view.getBigUint64(groupOffset + 0x38, true)) - 0x10200000,
          entry = heap.subarray(
            ep + position.entryIndex * 0xb8,
            ep + (position.entryIndex + 1) * 0xb8,
          ),
          contextPointer = view.getBigUint64(groupOffset + 0x28, true),
          contextCount = view.getUint32(groupOffset + 0x30, true),
          contextOffset = contextPointer - 0x10200000n;
        if (
          contextCount > 0 &&
          (contextOffset < 0n ||
            contextOffset % 4n !== 0n ||
            contextOffset + BigInt(contextCount) * 4n > BigInt(heap.length))
        )
          throw Error("Auxiliary effect contexts exceed decoded arena");
        const contexts = Array.from({ length: contextCount }, (_, index) =>
            view.getUint32(Number(contextOffset) + index * 4, true),
          ),
          result = execute(group, entry, position),
          data = new DataView(result.bytes.buffer),
          words = Object.fromEntries(
            Object.entries(meta.wordFields).map(([name, offset]) => [
              name,
              data.getUint32(offset, true),
            ]),
          ),
          scalars = Object.fromEntries(
            Object.entries(meta.scalarFields).map(([name, offset]) => [
              name,
              data.getFloat32(offset, true),
            ]),
          ),
          scalarBits = Object.fromEntries(
            Object.entries(meta.scalarFields).map(([name, offset]) => [
              name,
              data.getUint32(offset, true),
            ]),
          ),
          vector6c = [0, 1, 2].map((lane) =>
            data.getFloat32(0x6c + lane * 4, true),
          );
        if (![...Object.values(scalars), ...vector6c].every(Number.isFinite))
          throw Error("Nonfinite native effect-descriptor scalar/vector");
        return {
          ...position,
          ...words,
          byteFields: Object.fromEntries(
            Object.entries(meta.byteFields).map(([name, offset]) => [
              name,
              data.getUint8(offset),
            ]),
          ),
          ...scalars,
          scalarBits,
          vector6c,
          vector6cBits: [0, 1, 2].map((lane) =>
            data.getUint32(0x6c + lane * 4, true),
          ),
          unresolvedAuxiliaryContextIds: contexts,
          descriptorBytes: result.bytes,
          mutatedEntryBytes: result.mutatedEntryBytes,
          resolvedEntityPointersSuppliedZero: true,
          resourceLookupExecuted: false,
          factoryExecuted: false,
        };
      });
    },
    close() {
      if (!closed) {
        native.close();
        closed = true;
      }
    },
  };
}
