package com.shepherdjerred.thestorm.skylands.domain;

/**
 * The 48-bit linear congruential generator that {@code java.util.Random} specifies, reproduced so
 * that a world seed derives the same Beta noise tables Beta 1.7.3 derived from it.
 *
 * <p>This is deterministic world generation, not gameplay randomness: the sequence is a pure
 * function of the world seed. One instance is used only while {@link SkyTerrain} is constructed and
 * is never shared afterwards.
 */
final class Lcg48 {

  private static final long MULTIPLIER = 0x5DEECE66DL;
  private static final long ADDEND = 0xBL;
  private static final long MASK = (1L << 48) - 1;
  private static final double DOUBLE_UNIT = 0x1.0p-53;

  private long state;

  Lcg48(long seed) {
    state = (seed ^ MULTIPLIER) & MASK;
  }

  private int next(int bits) {
    state = (state * MULTIPLIER + ADDEND) & MASK;
    return (int) (state >>> (48 - bits));
  }

  /** {@code java.util.Random#nextDouble()}. */
  double nextDouble() {
    return (((long) next(26) << 27) + next(27)) * DOUBLE_UNIT;
  }

  /** {@code java.util.Random#nextInt(int)}, including its rejection of the biased tail. */
  int nextInt(int bound) {
    if (bound <= 0) {
      throw new IllegalArgumentException("bound must be positive: " + bound);
    }
    if ((bound & -bound) == bound) {
      return (int) ((bound * (long) next(31)) >> 31);
    }
    int bits;
    int value;
    do {
      bits = next(31);
      value = bits % bound;
    } while (bits - value + (bound - 1) < 0);
    return value;
  }
}
