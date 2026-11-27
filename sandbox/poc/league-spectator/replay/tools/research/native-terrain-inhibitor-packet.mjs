import {
  rotateByteLeft,
  swapAdjacentBits,
} from "./native-terrain-byte-codecs.mjs";

function decodeTimerByte(value) {
  const rotated = rotateByteLeft((value + 0x44) & 0xff, 1);
  const swapped = rotateByteLeft(swapAdjacentBits(rotated), 4);
  return rotateByteLeft(swapAdjacentBits(swapped), 1);
}

/** Opcode 947 body for the verified .8428 Barracks actor. */
export function readCurrentInhibitorPacketState(payload) {
  const header = payload[0];
  if (header === undefined || payload.length > 4)
    throw Error("Invalid inhibitor state packet width");

  // Original reader 0x1386cf0 selects a preset or reads an encoded u16 varint.
  const timerSelector = (header >>> 1) & 7;
  const hasTimer =
    timerSelector === 1 || (timerSelector >= 3 && timerSelector <= 5);
  if (!hasTimer && payload.length !== 1)
    throw Error("Unexpected inhibitor state timer bytes");
  if (hasTimer) {
    if (payload.length === 1) throw Error("Missing inhibitor state timer");
    for (let index = 1; index < payload.length; index++) {
      const value = decodeTimerByte(payload[index]);
      const hasNext = index < payload.length - 1;
      if (((value & 0x80) !== 0) !== hasNext || (index === 3 && value > 3))
        throw Error("Invalid inhibitor state timer framing");
    }
  }

  // The Barracks callback converts packet field +0x10 to actor state +0xd18.
  return header & 0x10 ? "alive" : "destroyed";
}
