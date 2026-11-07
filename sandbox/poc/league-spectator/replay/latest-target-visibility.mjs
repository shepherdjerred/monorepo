import { sha256 } from "./structural-comparison.mjs";

export const TARGET_VISIBILITY_INPUTS_SHA =
  "064971952f25f696e7d3d39ea75cf8cc18fd8a7dd89a6016f23d779026a37548";

// Opcode822 carries two serialized owner payloads. Decoding these bytes does
// not establish component lookup, owner callback success or live visibility.
export async function createLatestTargetVisibilityInputs({
  profile,
  image,
  packageBytes,
}) {
  if (
    !(image instanceof Uint8Array) ||
    !(packageBytes instanceof Uint8Array) ||
    (await sha256(packageBytes)) !== TARGET_VISIBILITY_INPUTS_SHA
  )
    throw Error("Pinned raw target visibility package required");
  const data = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    data.schema !== 1 ||
    data.kind !== "raw-target-visibility-inputs" ||
    data.build !== "16.21.829.8620" ||
    data.build !== profile.clientVersion ||
    data.protocol !== "20e09df23c66b85e" ||
    data.protocol !== profile.protocolDigest ||
    data.sliceSha256 !== profile.sliceSha256 ||
    data.decoderImageSha256 !== profile.decoderImageSha256 ||
    profile.imageBase !== 0x100000000 ||
    (await sha256(image)) !== data.decoderImageSha256 ||
    data.packet.opcode !== 822 ||
    data.packet.objectBytes !== 48 ||
    data.packet.vtableRva !== 0x23c90a0 ||
    data.packet.entityIdOffset !== 12 ||
    profile.packets?.[822]?.entryRva !== data.packet.decoderRva ||
    profile.packets?.[822]?.objectSize !== data.packet.objectBytes
  )
    throw Error("Incompatible raw target visibility build/layout");
  for (const range of data.originalRanges)
    if (
      (await sha256(image.subarray(range.rva, range.rva + range.bytes))) !==
      range.sha256
    )
      throw Error("Original target visibility instructions/data differ");
  const vtable = BigInt(profile.imageBase + data.packet.vtableRva);
  return Object.freeze({
    contract: Object.freeze({
      packageSha256: TARGET_VISIBILITY_INPUTS_SHA,
      rawOwnerPayloads: true,
      acceptedLiveVisibility: false,
    }),
    read(observation) {
      const object = observation?.object,
        heap = observation?.heap;
      if (
        observation?.complete !== true ||
        !(object instanceof Uint8Array) ||
        object.length !== 48 ||
        !(heap instanceof Uint8Array) ||
        heap.length < 48 ||
        heap.length > 0x200000 ||
        object.some((byte, index) => heap[index] !== byte)
      )
        throw Error(
          "Complete original bounded target visibility object/heap required",
        );
      const view = new DataView(
        object.buffer,
        object.byteOffset,
        object.byteLength,
      );
      if (
        view.getBigUint64(0, true) !== vtable ||
        view.getUint32(8, true) !== 822
      )
        throw Error("Original target visibility packet type differs");
      const result = {
        status: "raw-target-visibility-request",
        entityId: view.getUint32(12, true),
        acceptedByLiveUnit: null,
        visible: null,
        producerOmissions: Object.freeze([
          "visibility:component-lookup-and-owner-callbacks-unresolved",
        ]),
      };
      for (const vector of data.packet.vectors) {
        const pointer = view.getBigUint64(vector.offset, true),
          length = view.getUint32(vector.offset + 8, true),
          capacity = view.getUint32(vector.offset + 12, true);
        if (
          length > capacity ||
          capacity > heap.length ||
          (capacity &&
            (pointer < 0x10200030n ||
              pointer + BigInt(capacity) > 0x10200000n + BigInt(heap.length)))
        )
          throw Error(
            "Target visibility owner payload escaped its decoded heap",
          );
        const offset = capacity ? Number(pointer - 0x10200000n) : 0;
        result[vector.name] = Array.from(
          heap.subarray(offset, offset + length),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
      }
      return Object.freeze(result);
    },
  });
}
