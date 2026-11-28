import {
  recoverTerrainByteSubstitution,
  rotateByteLeft,
  swapAdjacentBits,
} from "./native-terrain-byte-codecs.mjs";
import { assertRecordedRiftEffectBuild } from "./recorded-rift-effect-packets.mjs";

const malformed = Symbol("Malformed effect creation prefix");
const u8 = (value) => value & 255;
const rotate = (value, bits) => rotateByteLeft(u8(value), bits);

class Cursor {
  constructor(bytes, offset) {
    if (
      !(bytes instanceof Uint8Array) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset >= bytes.length
    )
      throw malformed;
    this.bytes = bytes;
    this.offset = offset;
  }

  take(count = 1) {
    if (count > this.bytes.length - this.offset) throw malformed;
    const at = this.offset;
    this.offset += count;
    return this.bytes[at];
  }

  varint(decode, finalHighBit = false, maxBytes = 5) {
    let word = 0;
    for (let i = 0; i < maxBytes; i++) {
      const byte = decode(this.take());
      word |= (byte & 127) << (7 * i);
      if (((byte & 128) !== 0) === finalHighBit) return word >>> 0;
    }
    throw malformed;
  }

  count(decode, bytesPerItem) {
    const count = this.varint(decode);
    if (count > Math.floor((this.bytes.length - this.offset) / bytesPerItem))
      throw malformed;
    return count;
  }
}

// Key bytes in 0x116ec30 are decoded before the low seven bits are appended
// to the result. The same projection decodes the preset keys stored by
// 0x1144ea0 when no key bytes are present on the wire.
const keyByte = (byte) =>
  swapAdjacentBits(rotate(rotate(0x5b - byte, 3) + 0xec, 4));
const presetKey = (low, rest) =>
  (keyByte(low) | (keyByte(rest) * 0x1010100)) >>> 0;
const keyModes = [
  null,
  presetKey(0xd7, 0xd9),
  presetKey(0xf9, 0xf9),
  null,
  null,
  null,
  presetKey(0xd5, 0xd9),
  presetKey(0xd9, 0xd9),
];

const groupVectorCountByte = (byte) =>
  rotate((u8((rotate(byte, 2) + 0xed) ^ 0x9d) + 0xd5) ^ 0xd9, 3);
const shortGroupWordByte = (byte) =>
  rotate((0x99 - rotate(byte + 0xcd, 3)) ^ 0x3b, 5);

/**
 * Read the group count and any group's metadata at an independently established
 * wire offset. This reader deliberately stops at each entry array. It cannot
 * infer the next group offset or claim whole-body acceptance.
 */
export function createRecordedRiftCreatePrefixReader(replay, codecs) {
  assertRecordedRiftEffectBuild(replay);
  const table = recoverTerrainByteSubstitution(codecs);
  const groupCountByte = (byte) =>
    u8(0x57 - rotate(table[u8((rotate(byte, 1) ^ 0xcd) + 0xc9)], 5));
  const firstGroupWordByte = (byte) =>
    table[u8(table[rotate(rotate(~byte, 2) ^ 0x0a, 7)] + 0x41)];
  const secondGroupWordByte = (byte) => table[rotate(0xfb - byte, 3)];
  const vectorIdByte = (byte) => rotate(table[byte] + 0x7f, 2);
  const vectorWordByte = (byte) =>
    table[
      rotate(rotate(table[u8(swapAdjacentBits(byte) + 0x4e)], 6) ^ 0x94, 6)
    ];
  const trailingGroupWordByte = (byte) =>
    u8(rotate(rotate(table[u8(byte + 0xfb)], 3) + 0x9e, 6) + 0xe8);
  const entryCountByte = (byte) =>
    rotate(table[u8(table[u8(0x9a - byte)] + 0x5a)], 6);

  return {
    packetPrefix(bytes) {
      try {
        const cursor = new Cursor(bytes, 0);
        const hasGroups = (cursor.take() & 1) !== 0;
        const groupCount = hasGroups ? cursor.count(groupCountByte, 3) : 0;
        if (groupCount === 0 && cursor.offset !== bytes.length) return null;
        return { groupCount, firstGroupOffset: cursor.offset };
      } catch (error) {
        if (error === malformed) return null;
        throw error;
      }
    },
    groupPrefix(bytes, offset) {
      try {
        const cursor = new Cursor(bytes, offset);
        const first = cursor.take();
        const second = cursor.take();
        const third = cursor.take();
        // Group mode tables 0x11454e8..0x1145588. Most modes supply a
        // constructor preset; the tested mode masks identify wire scalars.
        if (third & 2) {
          const count = cursor.count(groupCountByte, 1);
          for (let i = 0; i < count; i++) cursor.varint(groupCountByte);
        }
        if ((1 << ((second >> 6) | ((third & 1) << 2))) & 0x4b)
          cursor.varint(firstGroupWordByte);
        if ((1 << (second & 7)) & 0x27)
          cursor.varint(secondGroupWordByte, true);
        if (first & 16) {
          const count = cursor.count(groupVectorCountByte, 2);
          for (let i = 0; i < count; i++) {
            const flags = cursor.take();
            const tail = cursor.take();
            // Helpers 0x1144030, 0x116cdd0 and 0x116d310. The vector's
            // fields do not feed the group's resource key.
            if ((1 << (flags & 7)) & 0xf9) cursor.varint(vectorIdByte);
            if ((1 << ((flags >> 6) | ((tail & 1) << 2))) & 0x6c)
              cursor.take(4);
            if ((1 << ((flags >> 3) & 7)) & 0x33) cursor.varint(vectorWordByte);
          }
        }
        const preset = keyModes[first & 7];
        const resourceKey = preset === null ? cursor.varint(keyByte) : preset;
        if ((1 << (first >> 5)) & 0x5c) cursor.varint(trailingGroupWordByte);
        if ((1 << ((second >> 3) & 7)) & 0xd1)
          cursor.varint(shortGroupWordByte, false, 3);
        const entryCount = first & 8 ? 0 : cursor.count(entryCountByte, 10);
        return { resourceKey, entryCount, entryOffset: cursor.offset };
      } catch (error) {
        if (error === malformed) return null;
        throw error;
      }
    },
  };
}
