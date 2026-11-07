import { sha256 } from "./structural-comparison.mjs";

export const LATEST_REPLICATION_SHA =
  "b69661b2c3fb470f030eebdd245c5481ff82463a85881e40062c94ccb3bbccdd";
const hex = (bytes) =>
  Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");

export async function createLatestReplicationReader(profile, image, bytes) {
  if (
    (await sha256(bytes)) !== LATEST_REPLICATION_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned latest replication package/image required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "latest-champion-health-replication" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !== profile.sliceSha256 ||
    meta.opcode !== 26 ||
    meta.objectBytes !== 48 ||
    meta.countOffset !== 32 ||
    meta.vectorOffset !== 16 ||
    meta.countDecode.length !== 256 ||
    new Set(meta.countDecode).size !== 256 ||
    meta.healthGroup !== 32 ||
    JSON.stringify(meta.fieldNames) !==
      JSON.stringify({ 0: "currentHealth", 1: "maxHealth" })
  )
    throw Error("Unsupported latest replication contract");
  for (const b of meta.sourceBlocks)
    if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Native replication instructions changed");
  return {
    metadata: structuredClone(meta),
    read(observation) {
      const object = observation.object,
        heap = observation.heap;
      if (!observation.complete || object.length !== 48)
        throw Error("Incomplete replication observation");
      const view = new DataView(
          object.buffer,
          object.byteOffset,
          object.byteLength,
        ),
        pointer = Number(view.getBigUint64(16, true)),
        length = view.getUint32(24, true),
        offset = pointer - 0x10200000;
      if (
        view.getUint32(8, true) !== 26 ||
        length > 0x1ff000 ||
        (length &&
          (!Number.isSafeInteger(offset) ||
            offset < 0 ||
            offset + length > heap.length))
      )
        throw Error("Replication vector escaped packet arena");
      const data = length
          ? heap.subarray(offset, offset + length)
          : new Uint8Array(),
        dv = new DataView(data.buffer, data.byteOffset, data.byteLength),
        records = [];
      let cursor = 0;
      const requireBytes = (count) => {
        if (cursor + count > data.length)
          throw Error("Truncated latest replication group/record");
      };
      while (cursor < data.length) {
        requireBytes(5);
        const start = cursor,
          groupMask = data[cursor++],
          entityId = dv.getUint32(cursor, true);
        cursor += 4;
        if (groupMask & 128)
          throw Error("Unknown latest replication group bit");
        const groups = [];
        for (const group of meta.groups) {
          if (!(groupMask & group)) continue;
          requireBytes(5);
          const mask = dv.getUint32(cursor, true),
            count = data[cursor + 4];
          cursor += 5;
          requireBytes(count);
          groups.push({
            group,
            mask,
            dataHex: hex(data.subarray(cursor, cursor + count)),
          });
          cursor += count;
        }
        records.push({
          entityId,
          offset: start,
          groupMask,
          groups,
          recordIndex: records.length,
        });
      }
      if (records.length !== meta.countDecode[object[32]])
        throw Error("Native replication record count differs");
      return records;
    },
    // The caller must establish the champion class from recorded creation IDs.
    championHealth(record) {
      const group = record.groups.find((g) => g.group === 32);
      if (!group) return null;
      const bytes = Uint8Array.from(group.dataHex.match(/../g) ?? [], (v) =>
          parseInt(v, 16),
        ),
        view = new DataView(bytes.buffer),
        fieldBits = {},
        values = {};
      let cursor = 0;
      for (let bit = 0; bit < 6; bit++) {
        if (!((group.mask >>> bit) & 1)) continue;
        if (cursor >= bytes.length)
          throw Error("Truncated native health prefix");
        let bits;
        if (bytes[cursor] === 255) {
          bits = 0;
          cursor++;
        } else {
          if (bytes[cursor] === 254) cursor++;
          if (cursor + 4 > bytes.length)
            throw Error("Truncated native health float");
          bits = view.getUint32(cursor, true);
          cursor += 4;
        }
        fieldBits[bit] = bits;
        if (meta.fieldNames[bit]) {
          const v = new DataView(new ArrayBuffer(4));
          v.setUint32(0, bits, true);
          const value = v.getFloat32(0, true);
          if (!Number.isFinite(value))
            throw Error("Nonfinite observed champion health");
          values[meta.fieldNames[bit]] = value;
        }
      }
      if (group.mask >>> 6 === 0 && cursor !== bytes.length)
        throw Error("Unexpected trailing bytes in complete health prefix");
      return {
        values,
        fieldBits,
        consumedPrefixBytes: cursor,
        uninterpretedMask: (group.mask & 0xfffffffc) >>> 0,
      };
    },
  };
}
