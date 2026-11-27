import {
  rotateByteLeft as rotate,
  swapAdjacentBits as swap,
} from "./native-terrain-byte-codecs.mjs";

/** Read the skin ID passed by the .8428 opcode 392 consumer to the actor factory. */
export function readCurrentNeutralRequestedSkinId(payload, table) {
  if (payload.length < 27) return;
  const selector = (payload[1] >>> 4) & 7;
  const defaults = [undefined, 1, 2, 0, undefined, 0xffffffff];
  const implicit = defaults[selector];
  if (implicit !== undefined) return implicit;

  const readNameLength = [
    (byte) => rotate(swap(table[byte]), 1) ^ 0xa6,
    (byte) => rotate(rotate(table[(byte + 0x41) & 255], 4) ^ 0xee, 1),
    (byte) => rotate(table[table[rotate(table[byte] ^ 0xa8, 7)]], 1),
  ][(payload[6] >>> 1) & 3];
  if (readNameLength === undefined) return;
  const nameLength = readNameLength(payload[26]);
  if (nameLength === 0) return;
  let cursor = 27 + nameLength;
  const readVarint = (decode) => {
    let result = 0;
    for (let i = 0; i < 5 && cursor < payload.length; i++) {
      const byte = decode(payload[cursor++]);
      result += (byte & 127) * 2 ** (7 * i);
      if (byte < 128) return result <= 0xffffffff ? result : undefined;
    }
  };
  const earlierStrings = [
    [
      null,
      (byte) => ((rotate(byte, 5) + 0xa9) & 255) ^ 0x52,
      (byte) => table[swap((rotate(table[rotate(byte, 5)], 3) + 0x7e) & 255)],
      (byte) =>
        (table[swap(rotate((byte + 0x8e) & 255, 7)) ^ 0xed] + 0x95) & 255,
    ][(payload[4] >>> 4) & 3],
    [
      (byte) =>
        (rotate(swap(((byte + 0x58) & 255) ^ 0x0f) ^ 0xc9, 6) + 0x2f) & 255,
      (byte) => ((swap(rotate(byte ^ 255, 3)) + 0xfc) & 255) ^ 255,
      null,
      (byte) =>
        table[((rotate(swap(rotate(byte, 4)) ^ 255, 7) ^ 0x48) + 0xee) & 255],
    ][(payload[2] >>> 4) & 3],
  ];
  for (const decode of earlierStrings) {
    if (decode === null) continue;
    const length = readVarint(decode);
    if (length === undefined || length > payload.length - cursor) return;
    cursor += length;
  }
  const earlierScalar = (payload[3] >>> 2) & 7;
  if (earlierScalar < 2 || earlierScalar >= 6) cursor += 4;

  return readVarint(
    (byte) => rotate(table[(0xec - swap(byte ^ 0x87)) & 255], 5) ^ 255,
  );
}
