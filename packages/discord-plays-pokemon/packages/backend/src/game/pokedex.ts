/** Species owned, counted from the save's Pokédex "owned" bitfield. */
export function countDexOwned(bitfield: Uint8Array): number {
  let total = 0;
  for (const byte of bitfield) total += popcount8(byte);
  return total;
}

function popcount8(byte: number): number {
  let n = byte & 0xff;
  n = n - ((n >> 1) & 0x55);
  n = (n & 0x33) + ((n >> 2) & 0x33);
  return (n + (n >> 4)) & 0x0f;
}
