import { sha256 } from "./structural-comparison.mjs";

export const MISSILE_TARGET_INPUTS_SHA =
  "16951cffdda21196138cf9ab337a5b258eb9efc0c416ffbe8dc86b8190e5fe21";

// Requested IDs come from the original CastInfo converter before its world
// lookup. They do not establish an accepted target, tracking pose or motion.
export async function createLatestMissileTargetInputs({
  profile,
  image,
  packageBytes,
}) {
  if ((await sha256(packageBytes)) !== MISSILE_TARGET_INPUTS_SHA)
    throw Error("Missile target input package hash differs");
  const definition = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    definition.schema !== 1 ||
    definition.build !== "16.21.829.8620" ||
    definition.build !== profile.clientVersion ||
    definition.protocol !== "20e09df23c66b85e" ||
    definition.protocol !== profile.protocolDigest ||
    definition.decoderImageSha256 !== profile.decoderImageSha256 ||
    definition.sliceSha256 !== profile.sliceSha256 ||
    profile.imageBase !== 0x100000000 ||
    (await sha256(image)) !== definition.decoderImageSha256 ||
    definition.targetRecordBytes !== 16 ||
    definition.targetRecordVtableRva !== 0x23d5be0 ||
    definition.networkId?.offset !== 8 ||
    definition.networkId?.bytes !== 4
  )
    throw Error("Incompatible missile target input build/layout");
  for (const range of definition.originalRanges)
    if (
      !Number.isSafeInteger(range.rva) ||
      range.rva < 0 ||
      !Number.isSafeInteger(range.bytes) ||
      range.bytes < 1 ||
      range.rva + range.bytes > image.length ||
      (await sha256(image.subarray(range.rva, range.rva + range.bytes))) !==
        range.sha256
    )
      throw Error("Missile target original instructions/data differ");
  const tables = definition.networkId.decode;
  const recordVtable = BigInt(
    profile.imageBase + definition.targetRecordVtableRva,
  );
  if (
    !Array.isArray(tables) ||
    tables.length !== 4 ||
    tables.some(
      (column) =>
        !Array.isArray(column) ||
        column.length !== 256 ||
        new Set(column).size !== 256 ||
        column.some((n) => !Number.isInteger(n) || n < 0 || n > 255),
    )
  )
    throw Error("Malformed missile target byte permutation");
  return Object.freeze({
    read(entriesHex, count) {
      if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > 65536 ||
        typeof entriesHex !== "string" ||
        entriesHex.length !== count * 32 ||
        !/^(?:[0-9a-f]{2})*$/i.test(entriesHex)
      )
        throw Error("Bounded original missile target records required");
      const bytes = Uint8Array.from(entriesHex.match(/../g) ?? [], (value) =>
        parseInt(value, 16),
      );
      const view = new DataView(bytes.buffer);
      const targets = [];
      for (let index = 0; index < count; index++) {
        const at = index * 16;
        if (view.getBigUint64(at, true) !== recordVtable)
          throw Error("Incompatible original missile target record type");
        let requestedEntityId = 0;
        for (let lane = 0; lane < 4; lane++)
          requestedEntityId +=
            tables[lane][bytes[at + 8 + lane]] * 2 ** (lane * 8);
        targets.push(
          Object.freeze({
            index,
            requestedEntityId,
            uninterpretedTailHex: entriesHex
              .slice(index * 32 + 24, (index + 1) * 32)
              .toLowerCase(),
            acceptedEntityId: null,
            status:
              "requested-network-target; world acceptance and tracking unresolved",
          }),
        );
      }
      return Object.freeze(targets);
    },
  });
}
