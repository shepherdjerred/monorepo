package com.shepherdjerred.thestorm.skylands.domain;

/**
 * Steele, Lea and Flood's SplitMix64: a counter-based generator for deterministic world generation,
 * seeded from the world seed and chunk position. Not gameplay randomness; one instance lives for
 * one chunk's ore plan on one thread.
 */
final class SplitMix64 {

  private static final long GAMMA = 0x9E3779B97F4A7C15L;

  private long state;

  SplitMix64(long seed) {
    state = seed;
  }

  static long finish(long value) {
    var z = value;
    z = (z ^ (z >>> 30)) * 0xBF58476D1CE4E5B9L;
    z = (z ^ (z >>> 27)) * 0x94D049BB133111EBL;
    return z ^ (z >>> 31);
  }

  long nextLong() {
    state += GAMMA;
    return finish(state);
  }

  /** Uniform in {@code [0, bound)}; the bias for the small bounds used here is negligible. */
  int nextInt(int bound) {
    return (int) Math.floorMod(nextLong(), (long) bound);
  }
}
