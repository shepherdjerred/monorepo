import { rotateByteLeft as rotateByte } from "./native-terrain-byte-codecs.mjs";

// Both selectors appear in the original readers 0x11a02e0 and 0x119df60.
const slotDefaults = [null, 0x4f, 0x63, null, null, 0xf8, null, 0x14];
const swapFromDefaults = [null, 0xd9, null, null, 0xf8, 0xf6, null, 0xf7];
const countCounterDefaults = [
  0x7979,
  0x797d,
  0x9292,
  null,
  null,
  null,
  null,
  0x7939,
];
const counterDefaults = [
  null,
  0xf84f,
  0x6363,
  null,
  null,
  0xf8f8,
  null,
  0xf814,
];
const decodeSlotIndex = (byte) => ((0x68 - byte) & 0xff) ^ 0x70;

function assertSlot(slot) {
  if (slot >= 39) throw Error("Inventory slot exceeds native bounds");
}

export function createCurrentInventorySlotReader(substitution) {
  if (!(substitution instanceof Uint8Array) || substitution.length !== 256)
    throw Error("Expected a 256-byte inventory substitution table");
  substitution = Uint8Array.from(substitution);
  const seen = new Uint8Array(256);
  for (const substituted of substitution) {
    if (seen[substituted])
      throw Error("Inventory substitution is not a permutation");
    seen[substituted] = 1;
  }

  function decodeSelectedByte(flags, body, offset) {
    if (slotDefaults[flags] === null && offset >= body.length)
      throw Error("Truncated inventory field");
    // The native reader and consumer apply inverse recoding to explicit bytes.
    return substitution[rotateByte(slotDefaults[flags] ?? body[offset], 6)];
  }

  function decodeSlot(flags, body, offset) {
    const slot = decodeSelectedByte(flags, body, offset);
    assertSlot(slot);
    return slot;
  }

  const decodeCountByte = (byte) =>
    rotateByte(
      substitution[rotateByte((0x6c - substitution[byte]) & 0xff, 2)],
      7,
    );
  const decodeCounterByte = (byte) => substitution[rotateByte(byte, 6)];

  function decodeCounterWord(word, decodeByte) {
    return decodeByte(word & 0xff) | (decodeByte(word >>> 8) << 8);
  }

  function readCounterVarUint(body, offset, decodeByte) {
    let value = 0;
    for (let shift = 0; shift <= 14 && offset < body.length; shift += 7) {
      const byte = decodeByte(body[offset++]);
      value |= (byte & 0x7f) << shift;
      if (value > 0xffff) break;
      if (byte < 0x80) return { value, offset };
    }
    throw Error("Truncated or out-of-range inventory counter");
  }

  function readSwap(body) {
    const toSelector = body[0] & 7;
    const fromSelector = (body[0] >>> 3) & 7;
    const toBytes = Number(slotDefaults[toSelector] === null);
    const expectedLength =
      1 + toBytes + Number(swapFromDefaults[fromSelector] === null);
    if (body.length !== expectedLength)
      throw Error("Invalid inventory swap length");
    const fromWire = swapFromDefaults[fromSelector] ?? body[1 + toBytes];
    const from = decodeSlotIndex(fromWire);
    assertSlot(from);
    return { from, to: decodeSlot(toSelector, body, 1) };
  }

  function readCount(body) {
    if (body.length < 2) throw Error("Truncated inventory count header");
    const flags = body[0];
    const otherSelector = (flags >>> 7) | ((body[1] & 3) << 1);
    const countSelector = flags & 7;
    if (
      ![0, 2, 3, 6].includes(otherSelector) ||
      (countSelector !== 0 && countSelector !== 7)
    )
      throw Error("Unsupported inventory count layout");

    // These four bytes belong to a field unused by the slot/count consumer.
    const slotSelector = (flags >>> 3) & 7;
    const expectedLength = 6 + Number(slotDefaults[slotSelector] === null);
    if (body.length !== expectedLength)
      throw Error("Invalid inventory count length");
    const storedCount = countSelector === 0 ? 0x79 : 0x39;
    const count = decodeCountByte(storedCount);
    return { slot: decodeSlot(slotSelector, body, 6), count };
  }

  // Opcode 1143 changes the count and item counter in one slot.
  function readCountAndCounter(body) {
    if (body.length < 2)
      throw Error("Truncated inventory count/counter header");
    const [flags, second] = body;
    const countSelector = (flags >>> 3) & 7;
    const slotSelector = (flags >>> 6) | ((second & 1) << 2);
    let offset = 2;
    const count = decodeSelectedByte(countSelector, body, offset);
    offset += Number(slotDefaults[countSelector] === null);
    const storedSlot = swapFromDefaults[slotSelector] ?? body[offset++];
    const slot = decodeSlotIndex(storedSlot);
    assertSlot(slot);
    const storedCounter = countCounterDefaults[flags & 7];
    let counter;
    if (storedCounter === null) {
      ({ value: counter, offset } = readCounterVarUint(
        body,
        offset,
        decodeCountByte,
      ));
    } else {
      counter = decodeCounterWord(storedCounter, decodeCountByte);
    }
    if (offset !== body.length)
      throw Error("Invalid inventory count/counter length");
    return { slot, count, counter };
  }

  // Opcode 248 changes the item counter only.
  function readCounter(body) {
    const flags = body[0];
    const storedCounter = counterDefaults[flags & 7];
    let offset = 1;
    let counter;
    if (storedCounter === null) {
      ({ value: counter, offset } = readCounterVarUint(
        body,
        offset,
        decodeCounterByte,
      ));
    } else {
      counter = decodeCounterWord(storedCounter, decodeCounterByte);
    }
    const storedSlot = swapFromDefaults[(flags >>> 3) & 7] ?? body[offset++];
    if (offset !== body.length) throw Error("Invalid inventory counter length");
    const slot = decodeSlotIndex(storedSlot);
    assertSlot(slot);
    return { slot, counter };
  }

  return (opcode, body) => {
    if (!(body instanceof Uint8Array) || body.length === 0)
      throw Error("Empty or invalid inventory mutation body");
    switch (opcode) {
      case 226:
        return readSwap(body);
      case 797:
        return readCount(body);
      case 1143:
        return readCountAndCounter(body);
      case 248:
        return readCounter(body);
      default:
        throw Error(`Unsupported inventory mutation opcode ${opcode}`);
    }
  };
}
