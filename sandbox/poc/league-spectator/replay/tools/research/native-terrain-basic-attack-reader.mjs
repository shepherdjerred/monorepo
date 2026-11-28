import {
  currentTerrainPositionBuild,
  rotateByteLeft,
  swapAdjacentBits,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

export const currentBasicAttackOpcodes = new Set([98, 992]);
const implicitTimingBytes = [
  0x5c,
  undefined,
  0x1c,
  0xdc,
  undefined,
  undefined,
  0x9c,
];
const implicitSlotBytes = [0xa6, 0x2d, undefined, undefined, 0x85, 0x9b];

/**
 * Read the compact BasicAttackData route in the exact .8428 packet readers.
 * The owning context and clock are transport fields. The requested slot is
 * read before the original receiver's optional actor-dependent slot override.
 */
export function createCurrentBasicAttackReader(replay, substitution) {
  if (
    replay?.build !== currentTerrainPositionBuild ||
    replay.protocol !== terrainPositionProtocol
  )
    throw Error("Expected an exact current replay for basic attacks");
  if (!(substitution instanceof Uint8Array) || substitution.length !== 256)
    throw Error("Expected authenticated basic attack byte substitution");

  const sequenceDigit = (byte) => {
    const encoded =
      rotateByteLeft((substitution[byte ^ 0xa0] + 0xc7) & 255, 3) ^ 0xec;
    // The native sequence reader shifts AL before testing its sign bit.
    return ((encoded & 64) << 1) | (encoded & 63);
  };
  const auxiliaryDigit = (byte) =>
    substitution[
      (rotateByteLeft((substitution[byte ^ 0x50] + 0xb7) & 255, 5) + 0x56) & 255
    ] ^ 255;
  const targetDigit = (byte) =>
    rotateByteLeft(
      swapAdjacentBits(
        substitution[rotateByteLeft(swapAdjacentBits(byte), 4)] ^ 0x5f,
      ) ^ 0x68,
      3,
    );
  const slotByte = (byte) => {
    let value = rotateByteLeft(swapAdjacentBits(rotateByteLeft(byte, 6)), 6);
    value = substitution[substitution[substitution[value]]];
    return substitution[swapAdjacentBits(value)];
  };

  return (opcode, payload) => {
    if (!(payload instanceof Uint8Array) || payload.length < 4) return null;
    const [wrapper, first, second, third] = payload;
    const suffixBytes = opcode === 992 && wrapper === 0xa5 ? 8 : 0;
    if (suffixBytes === 0 && (opcode !== 98 || wrapper !== 0xc2)) return null;
    // The nested cast vector has its own reader and never appears on the
    // supported ordinary basic-attack packet cohort.
    if (second & 4) return null;
    const end = payload.length - suffixBytes;
    let cursor = 4;
    function readVarUint(decode) {
      let value = 0;
      for (let shift = 0; shift < 35 && cursor < end; shift += 7) {
        const digit = decode(payload[cursor++]);
        value += (digit & 127) * 2 ** shift;
        if (value > 0xffffffff) break;
        if (!(digit & 128)) return value;
      }
      return undefined;
    }
    const sequenceMode = (second >>> 3) & 7;
    if (
      (sequenceMode === 2 ||
        sequenceMode === 3 ||
        sequenceMode === 4 ||
        sequenceMode === 6) &&
      readVarUint(sequenceDigit) === undefined
    )
      return null;
    if (!(first & 8)) cursor += 12;
    const implicitTiming = implicitTimingBytes[first & 7];
    if (implicitTiming === undefined && cursor >= end) return null;
    const timingByte = implicitTiming ?? payload[cursor++];
    const auxiliaryMode = (second >>> 6) | ((third & 1) << 2);
    if (
      auxiliaryMode !== 4 &&
      auxiliaryMode !== 6 &&
      readVarUint(auxiliaryDigit) === undefined
    )
      return null;
    if (cursor > end) return null;
    const slotMode = (first >>> 4) & 7;
    const encodedSlot = implicitSlotBytes[slotMode];
    if (encodedSlot === undefined && cursor >= end) return null;
    const requestedSlot = slotByte(encodedSlot ?? payload[cursor++]);
    if (requestedSlot < 64 || requestedSlot > 81) return null;
    const targetMode = (first >>> 7) | ((second & 3) << 1);
    if (targetMode === 5 || targetMode === 6) return null;
    const wireTarget = readVarUint(targetDigit);
    if (wireTarget === undefined || cursor !== end) return null;
    const targetId =
      wireTarget & 0xffffff ? (wireTarget ^ 0x40000000) >>> 0 : wireTarget;
    // The receiver divides this signed integer by 100 before applying
    // its live clock and actor adjustment.
    const timingOffsetCentiseconds =
      ((0xa6 - rotateByteLeft(timingByte ^ 0xb5, 2)) & 255) - 128;
    return { targetId, requestedSlot, timingOffsetCentiseconds };
  };
}
