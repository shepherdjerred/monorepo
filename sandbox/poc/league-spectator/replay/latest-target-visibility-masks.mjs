import { sha256 } from "./structural-comparison.mjs";

export const TARGET_VISIBILITY_MASK_INPUTS_SHA =
  "e3847e20957bbd54375fe8813b391c0b324816a7409c3284dfd2c0671ff313b1";
export const TARGET_VISIBILITY_MASK_OPCODES = Object.freeze([48, 582, 918]);

// Decoded fields are requests. Routing to a live visibility component and the
// concrete owner callbacks remain separate from original packet decoding.
export async function createLatestTargetVisibilityMaskInputs({
  profile,
  image,
  packageBytes,
}) {
  if (
    !(image instanceof Uint8Array) ||
    !(packageBytes instanceof Uint8Array) ||
    (await sha256(packageBytes)) !== TARGET_VISIBILITY_MASK_INPUTS_SHA
  )
    throw Error("Pinned raw visibility mask/reset package required");
  const data = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    data.schema !== 1 ||
    data.kind !== "raw-target-visibility-mask-inputs" ||
    data.build !== "16.21.829.8620" ||
    data.build !== profile.clientVersion ||
    data.protocol !== "20e09df23c66b85e" ||
    data.protocol !== profile.protocolDigest ||
    data.sliceSha256 !== profile.sliceSha256 ||
    data.decoderImageSha256 !== profile.decoderImageSha256 ||
    profile.imageBase !== 0x100000000 ||
    (await sha256(image)) !== data.decoderImageSha256
  )
    throw Error("Incompatible raw visibility mask/reset build");
  const packets = new Map(
    data.packets.map((packet) => [packet.opcode, packet]),
  );
  for (const opcode of TARGET_VISIBILITY_MASK_OPCODES) {
    const packet = packets.get(opcode);
    if (
      profile.packets?.[opcode]?.entryRva !== packet.decoderRva ||
      profile.packets?.[opcode]?.objectSize !== packet.objectBytes
    )
      throw Error("Incompatible visibility mask/reset packet layout");
  }
  for (const range of data.originalRanges)
    if (
      (await sha256(image.subarray(range.rva, range.rva + range.bytes))) !==
      range.sha256
    )
      throw Error("Original visibility mask/reset instructions differ");
  return Object.freeze({
    opcodes: TARGET_VISIBILITY_MASK_OPCODES,
    contract: Object.freeze({
      packageSha256: TARGET_VISIBILITY_MASK_INPUTS_SHA,
      rawEncodedViewSlotByte: true,
      componentRoutingAccepted: false,
      acceptedLiveVisibility: false,
    }),
    read(observation) {
      const object = observation?.object,
        heap = observation?.heap;
      if (
        observation?.complete !== true ||
        !(object instanceof Uint8Array) ||
        object.length < 16 ||
        !(heap instanceof Uint8Array) ||
        heap.length < object.length ||
        heap.length > 0x200000 ||
        object.some((byte, index) => heap[index] !== byte)
      )
        throw Error(
          "Complete original bounded visibility mask/reset object/heap required",
        );
      const view = new DataView(
          object.buffer,
          object.byteOffset,
          object.byteLength,
        ),
        opcode = view.getUint32(8, true),
        packet = packets.get(opcode);
      if (
        !packet ||
        object.length !== packet.objectBytes ||
        view.getBigUint64(0, true) !==
          BigInt(profile.imageBase + packet.vtableRva)
      )
        throw Error("Original visibility mask/reset packet type differs");
      return Object.freeze({
        status:
          opcode === 918
            ? "raw-target-visibility-reset-request"
            : "raw-target-visibility-mask-request",
        opcode,
        entityId: view.getUint32(packet.entityIdOffset, true),
        ...(opcode === 918
          ? {}
          : {
              encodedViewSlotByte: view.getUint8(
                packet.encodedViewSlotByteOffset,
              ),
            }),
        rawObjectHex: Array.from(object, (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
        acceptedByLiveUnit: null,
        visible: null,
        producerOmissions: Object.freeze([
          "visibility:component-routing-and-owner-callbacks-unresolved",
        ]),
      });
    },
  });
}
