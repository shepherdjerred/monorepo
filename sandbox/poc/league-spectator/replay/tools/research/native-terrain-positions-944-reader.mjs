function rotateLeft(byte, shift) {
  return ((byte << shift) | (byte >>> (8 - shift))) & 0xff;
}

function hasContinuation(byte) {
  const rotated = rotateLeft(((rotateLeft(byte, 4) ^ 0xd2) + 0xce) & 0xff, 1);
  return ((0x88 - rotated) & 0x80) !== 0;
}

function readPosition(payload, decodeByte) {
  if (!(payload instanceof Uint8Array) || payload.length < 2)
    throw Error("Truncated opcode 944 position body");
  const [first, second] = payload;
  const form = first & ~0x40;
  const idSelector = (second >>> 2) & 7;
  if (
    ![0xb0, 0xb1, 0xb3, 0xb4, 0xb6].includes(form) ||
    (second & 0x21) !== 0 ||
    idSelector === 1 ||
    idSelector === 7
  )
    throw Error("Unsupported opcode 944 position body form");

  // The first scalar is constant for form 0xb1. Other admitted forms consume
  // four bytes. Their next wire field uses a transformed continuation bit.
  const start = form === 0xb1 ? 2 : 6;
  const vectorPresent = (first & 0x40) === 0;
  const vectorOffset = payload.length - (vectorPresent ? 8 : 0);
  const idLength = vectorOffset - start;
  // All admitted ID selectors read at least one byte and stop when its
  // transformed continuation bit is clear, regardless of the first form.
  if (idLength < 1 || idLength > (form === 0xb1 ? 2 : 3))
    throw Error("Unexpected opcode 944 position body length");
  for (let offset = start; offset < vectorOffset; offset++) {
    if (hasContinuation(payload[offset]) !== offset < vectorOffset - 1)
      throw Error("Invalid opcode 944 position body continuation");
  }
  if (!vectorPresent) return null;

  // Reader RVA 0x126d110 assembles two big-endian words at object +0x34.
  // The original semantic consumer reads them as float32 at RVA 0xac1c8.
  const vector = Uint8Array.from(payload.subarray(vectorOffset), decodeByte);
  const view = new DataView(vector.buffer);
  const x = view.getFloat32(0);
  const z = view.getFloat32(4);
  if (!Number.isFinite(x) || !Number.isFinite(z))
    throw Error("Invalid opcode 944 position coordinates");
  return { x, z };
}

export function createPosition944ReaderFromCodecs({ decodePositionByte }) {
  return (payload) => readPosition(payload, decodePositionByte);
}
