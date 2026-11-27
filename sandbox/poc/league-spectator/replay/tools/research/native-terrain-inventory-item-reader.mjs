import {
  rotateByteLeft,
  swapAdjacentBits,
} from "./native-terrain-byte-codecs.mjs";

const implicitItemIds = [
  null,
  0xd9d9d9d9,
  null,
  null,
  0xf8f8f8f8,
  0xf8f8f8f6,
  null,
  0xf8f8f8f7,
];
const implicitSlots = [null, 0x4f, 0x63, null, null, 0xf8, null, 0x14];
const implicitCounts = [0x79, 0x7d, 0x92, null, null, null, null, 0x39];
const implicitCounters = [
  null,
  0x6161,
  null,
  0x186c,
  null,
  0x18f3,
  0x1818,
  null,
];

const decodeItemIdByte = (byte) => ((0x68 - byte) & 0xff) ^ 0x70;

function decodeItemPropertyLengthByte(wire) {
  const digit = (swapAdjacentBits(wire) ^ 0x39) + 0x2c;
  const rotated = rotateByteLeft(digit & 0xff, 3);
  return rotateByteLeft((rotated + 0x0d) & 0xff, 5);
}

function decodeImplicitItemId(value) {
  let result = 0;
  for (let shift = 0; shift < 32; shift += 8)
    result |= decodeItemIdByte((value >>> shift) & 0xff) << shift;
  return result >>> 0;
}

/** Exact item-row reader shared by the current native assignment and checkpoint packets. */
export function readCurrentInventoryItem(payload, offset, substitution) {
  if (
    !(payload instanceof Uint8Array) ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw Error("Invalid current inventory item input");
  let cursor = offset;
  function requireBytes(length) {
    if (cursor + length > payload.length)
      throw Error("Truncated current inventory item");
  }
  function take() {
    requireBytes(1);
    return payload[cursor++];
  }
  function skip(length) {
    requireBytes(length);
    cursor += length;
  }
  function varint(decode, limit) {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = decode(take());
      value += (byte & 0x7f) * 2 ** shift;
      if (value > limit) break;
      if ((byte & 0x80) === 0) return value;
    }
    throw Error("Invalid current inventory item integer");
  }
  const first = take();
  const second = take();
  const third = take();
  if (
    ((second >>> 3) & 3) !== 3 ||
    (third & 0x60) !== 0 ||
    (first & 0x40) !== 0 ||
    (third & 0x10) === 0
  )
    throw Error("Unverified current inventory item layout");
  const implicitItemId = implicitItemIds[third & 7];
  const itemId =
    implicitItemId === null
      ? varint(decodeItemIdByte, 0xffffffff)
      : decodeImplicitItemId(implicitItemId);
  const slot =
    substitution[rotateByteLeft(implicitSlots[second & 7] ?? take(), 6)];
  const countByte = implicitCounts[first & 7] ?? take();
  const count = rotateByteLeft(
    substitution[rotateByteLeft((0x6c - substitution[countByte]) & 0xff, 2)],
    7,
  );
  function counterByte(wire) {
    const index = (swapAdjacentBits(wire) + 0x53) & 0xff;
    const rotated = rotateByteLeft(substitution[substitution[index]], 5);
    return ((swapAdjacentBits(rotated) ^ 0x7e) + 0xbd) & 0xff;
  }
  const implicitCounter = implicitCounters[second >>> 5];
  const counter =
    implicitCounter === null
      ? varint(counterByte, 0xffff)
      : counterByte(implicitCounter & 0xff) |
        (counterByte(implicitCounter >>> 8) << 8);
  if ((third & 0x08) !== 0) {
    // The native item reader consumes these properties before its trailing field.
    const propertyCount = varint(decodeItemPropertyLengthByte, 0xffffffff);
    requireBytes(propertyCount);
    for (let index = 0; index < propertyCount; index++) {
      const flags = take();
      if ([0, 3, 4, 6].includes(flags & 7)) skip(4);
      if ([0, 2, 3, 6].includes((flags >>> 3) & 7))
        varint(decodeItemIdByte, 0xffffffff);
    }
  }
  if ([0, 1, 2, 7].includes((first >>> 3) & 7)) skip(4);
  if (slot >= 39) throw Error("Current inventory item slot is out of range");
  return { slot, itemId: itemId >>> 0, count, counter, nextOffset: cursor };
}

export function createCurrentInventoryItemReader(substitution) {
  return (opcode, body) => {
    if (
      !(body instanceof Uint8Array) ||
      body.length < 4 ||
      (body[0] & 1) !== 1 ||
      (opcode !== 190 && opcode !== 840)
    )
      throw Error("Unverified current inventory assignment layout");
    const prefix =
      opcode === 840 && [0, 3, 5, 7].includes((body[0] >>> 3) & 7) ? 5 : 1;
    const { nextOffset, ...item } = readCurrentInventoryItem(
      body,
      prefix,
      substitution,
    );
    if (nextOffset !== body.length)
      throw Error("Current inventory assignment has trailing bytes");
    return item;
  };
}
