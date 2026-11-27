import {
  rotateByteLeft,
  swapAdjacentBits,
} from "./native-terrain-byte-codecs.mjs";
import { readCurrentInventoryItem } from "./native-terrain-inventory-item-reader.mjs";

const snapshotOpcodes = new Set([415, 1214]);
const slotStorageLimit = 39;

// x86 slice 0x1199e60 and 0x11984d0. Each group selects one of
// four encoded constants or four wire readers for an unused u32 field.
const u32ReaderSelectors = [
  0b00111010, 0b10100011, 0b01100110, 0b10111000, 0b10101001, 0b01010101,
];

/** Read the exact .8428 snapshot envelope and rows, in native vector order. */
export function createCurrentInventorySnapshotReader(substitution) {
  return (opcode, payload) => {
    if (!snapshotOpcodes.has(opcode) || !(payload instanceof Uint8Array))
      throw Error("Expected an exact inventory snapshot body");
    let offset = 0;
    const take = () => {
      if (offset >= payload.length)
        throw Error("Truncated current inventory snapshot");
      return payload[offset++];
    };
    const readUnsigned = (mapByte, bits) => {
      let value = 0;
      for (let shift = 0; shift < bits; shift += 7) {
        const decoded = mapByte(take());
        value += (decoded & 0x7f) * 2 ** shift;
        if (decoded < 0x80) {
          if (value >= 2 ** bits)
            throw Error("Current inventory snapshot integer overflow");
          return value;
        }
      }
      throw Error("Unterminated current inventory snapshot integer");
    };
    if (!(take() & 1)) {
      if (offset !== payload.length)
        throw Error("Trailing bytes in default current inventory snapshot");
      return { entries: [] };
    }
    const flags = take();
    if ((0b01001101 >>> ((flags >>> 1) & 7)) & 1)
      readUnsigned((byte) => (0x68 - byte) & 0xff, 32);
    // The vector count uses a set high bit for its final digit.
    const count =
      flags & 1
        ? 0
        : readUnsigned(
            (byte) =>
              ((rotateByteLeft((swapAdjacentBits(byte) + 0x41) & 0xff, 5) +
                0x52) &
                0xff) ^
              0x80,
            32,
          );
    if (count > slotStorageLimit)
      throw Error("Current inventory snapshot exceeds native slot capacity");
    const entries = Array(count);
    // The native vector decoder writes wire rows from the last slot backward.
    for (let index = count - 1; index >= 0; index--) {
      const a = take();
      const b = take();
      const c = take();
      const d = take();
      const selectors = [
        (b >>> 1) & 7,
        (c >>> 6) | ((d & 1) << 2),
        (a >>> 3) & 7,
        (c >>> 2) & 7,
        a & 7,
        (b >>> 4) & 7,
      ];
      for (const [field, selector] of selectors.entries()) {
        if ((u32ReaderSelectors[field] >>> selector) & 1)
          for (let byte = 0; byte < 4; byte++) take();
      }
      if ((0b10111000 >>> ((a >>> 6) | ((b & 1) << 2))) & 1)
        readUnsigned((byte) => substitution[((0x52 + byte) & 0xff) ^ 0xac], 16);
      if (c & 0x20) {
        const { slot, itemId, count, counter, nextOffset } =
          readCurrentInventoryItem(payload, offset, substitution);
        if (
          !Number.isInteger(nextOffset) ||
          nextOffset <= offset ||
          nextOffset > payload.length
        )
          throw Error("Invalid current inventory item boundary");
        offset = nextOffset;
        entries[index] = { slot, itemId, count, counter };
      } else {
        entries[index] = { slot: 0, itemId: 0, count: 0, counter: 0 };
      }
      if ((0b01000111 >>> ((b >>> 7) | ((c & 3) << 1))) & 1)
        readUnsigned(
          (byte) =>
            (rotateByteLeft((rotateByteLeft(byte, 2) + 0x8e) & 0xff, 2) +
              0x2c) &
            0xff,
          16,
        );
    }
    if (offset !== payload.length)
      throw Error("Trailing bytes in current inventory snapshot");
    return { entries };
  };
}
