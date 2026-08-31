export type SecureRandom = (maximumExclusive: number) => number;

export function secureRandomInt(maximumExclusive: number): number {
  if (!Number.isSafeInteger(maximumExclusive) || maximumExclusive <= 0) {
    throw new Error("maximumExclusive must be a positive safe integer");
  }
  const range = 0x1_00_00_00_00;
  const limit = range - (range % maximumExclusive);
  const values = new Uint32Array(1);
  let value = range;
  while (value >= limit) {
    globalThis.crypto.getRandomValues(values);
    const generated = values.at(0);
    if (generated === undefined)
      throw new Error("Web Crypto did not return a random value");
    value = generated;
  }
  return value % maximumExclusive;
}

export function secureShuffle<T>(
  values: readonly T[],
  random: SecureRandom = secureRandomInt,
): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = random(index + 1);
    const current = shuffled[index];
    const swap = shuffled[swapIndex];
    if (current === undefined || swap === undefined) {
      throw new Error("shuffle index escaped array bounds");
    }
    shuffled[index] = swap;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}
