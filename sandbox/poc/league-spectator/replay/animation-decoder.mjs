import { animationTables } from "./animation-tables.mjs";
const swap = (v) => ((v & 0x55) << 1) | ((v >>> 1) & 0x55);
export function decodeAnimation(payload) {
  if (payload.length < 3) throw Error("Truncated animation selectors");
  const flags = payload[0] | (payload[1] << 8) | (payload[2] << 16);
  let cursor = 3;
  const read = () => {
    if (cursor >= payload.length) throw Error("Truncated animation fields");
    return payload[cursor++];
  };
  const rateSelector = (flags >>> 7) & 7;
  let rawRate = { 0: 2, 7: -1, 4: 0, 2: 1 }[rateSelector];
  if (rawRate === undefined) {
    const b = new Uint8Array(4);
    for (let i = 0; i < 4; i++) b[3 - i] = ((swap(read()) - 0x52) & 255) ^ 0xfe;
    rawRate = new DataView(b.buffer).getFloat32(0, true);
  }
  if (!Number.isFinite(rawRate) || Math.abs(rawRate) > 100)
    throw Error("Invalid animation rate");
  if ([1, 4, 5, 6].includes(flags & 7)) {
    for (let i = 0; i < 4; i++) read();
  }
  if (flags & (1 << 15)) throw Error("Unverified animation state");
  const mode = (flags >>> 10) & 3;
  if (mode === 0) return { animationName: "", rawRate };
  const table = animationTables[mode];
  let length = 0;
  for (let shift = 0; ; shift += 7) {
    if (shift >= 28) throw Error("Oversized animation string");
    const b = table[read()];
    length += (b & 127) * 2 ** shift;
    if (!(b & 128)) break;
  }
  if (length > 1024 || cursor + length > payload.length)
    throw Error("Invalid animation name length");
  const name = new Uint8Array(length);
  if (mode === 1) {
    let lo = 0,
      hi = length - 1;
    while (lo < hi) {
      name[lo++] = table[read()];
      name[hi--] = table[read()];
    }
    if (lo === hi) name[lo] = table[read()];
  } else for (let i = 0; i < length; i++) name[i] = table[read()];
  return {
    animationName: new TextDecoder("utf-8", { fatal: true }).decode(name),
    rawRate,
  };
}
