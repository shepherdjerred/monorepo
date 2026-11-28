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
const firstCoordinateModes = [
  null,
  0xdc12,
  null,
  0xdcdc,
  null,
  null,
  0x6565,
  0xdca7,
];
const secondCoordinateModes = [
  0x3535,
  0xb5b5,
  0x353a,
  0x35b6,
  null,
  null,
  null,
  null,
];
const lowWord = (word, decode) =>
  decode(word & 255) | (decode(word >>> 8) << 8);
const signedWord = (word) => (word << 16) >> 16;

/** Project compact coordinates after the native Map11 grid initializer. */
export function createRecordedRiftPlacementGrid(replay, bounds) {
  assertRecordedRiftEffectBuild(replay);
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3]
  )
    throw Error("Verified Map11 X/Z bounds required");
  const [minX, minZ, maxX, maxZ] = bounds;
  const f = Math.fround;
  const origins = [
    [minX, maxX],
    [minZ, maxZ],
  ].map(([min, max]) => {
    // 0x16db78c adds binary32 bounds before truncating and halving the
    // signed 16-bit sum. Keep this provider limited to its proven range.
    const sum = Math.trunc(f(f(min) + f(max)));
    if (!Number.isInteger(sum) || signedWord(sum) !== sum)
      throw Error("Map11 grid origin exceeds its native signed word");
    return Math.trunc(sum / 2);
  });
  return (axis, word) => {
    if (
      (axis !== 0 && axis !== 2) ||
      !Number.isInteger(word) ||
      signedWord(word) !== word
    )
      throw Error("Signed grid word and X/Z axis required");
    // 0x16d7af0 and 0x16d7b30 both select the 2.0f step in this mode.
    return f(f(word * 2) + origins[axis / 2]);
  };
}

/**
 * Read packet, group, and early entry fields at independently established
 * offsets. Group metadata stops at the entry array. Entry metadata stops
 * before the word at native entry +0x18.
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
  const entryVectorByte = (byte) =>
    table[rotate(table[swapAdjacentBits(rotate(byte, 4))], 7)];
  const firstCoordinateByte = (byte) =>
    swapAdjacentBits(table[rotate(byte ^ 0x53, 2)]);
  const projectSecondCoordinateByte = (byte) => {
    const swapped = swapAdjacentBits(rotate(byte + 0x84, 1));
    return u8(swapAdjacentBits(u8((swapped ^ 0x15) + 0x41)) + 0x25);
  };

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
    entryPrefix(bytes, offset) {
      try {
        const cursor = new Cursor(bytes, offset);
        // 0x1140310 reserves the ten-byte flag header before reading data.
        cursor.take(10);
        const vectorBits = [0, 0, 0];
        if (bytes[offset + 3] & 2) {
          // 0x1167a10 writes three fixed-width words in little-endian order.
          // Preserve their bit patterns without assuming a placement meaning.
          for (let axis = 0; axis < 3; axis++) {
            let word = 0;
            for (let i = 0; i < 4; i++)
              word |= entryVectorByte(cursor.take()) << (8 * i);
            vectorBits[axis] = word >>> 0;
          }
        }
        const firstMode =
          (bytes[offset + 2] >> 6) | ((bytes[offset + 3] & 1) << 2);
        const firstPreset = firstCoordinateModes[firstMode];
        const firstPacked =
          firstPreset === null
            ? cursor.varint(firstCoordinateByte, false, 3)
            : lowWord(firstPreset, firstCoordinateByte);
        const secondMode = (bytes[offset + 5] >> 2) & 7;
        const secondPreset = secondCoordinateModes[secondMode];
        const secondPacked =
          secondPreset === null
            ? cursor.varint(projectSecondCoordinateByte, false, 3)
            : lowWord(secondPreset, projectSecondCoordinateByte);
        return {
          vectorBits,
          xGridWords: [signedWord(firstPacked), signedWord(secondPacked)],
          nextOffset: cursor.offset,
        };
      } catch (error) {
        if (error === malformed) return null;
        throw error;
      }
    },
  };
}
