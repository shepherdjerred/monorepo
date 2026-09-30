package com.shepherdjerred.thestorm.quests.domain.board;

/**
 * SplitMix64: a tiny deterministic generator, so a board quest can be generated again from its
 * stored seed. The seed itself comes from the module's injected randomness.
 */
final class SplitMix {

  private long state;

  SplitMix(long seed) {
    this.state = seed;
  }

  long nextLong() {
    state += 0x9E3779B97F4A7C15L;
    var mixed = state;
    mixed = (mixed ^ (mixed >>> 30)) * 0xBF58476D1CE4E5B9L;
    mixed = (mixed ^ (mixed >>> 27)) * 0x94D049BB133111EBL;
    return mixed ^ (mixed >>> 31);
  }

  /** A value in {@code [0, bound)}. */
  int nextInt(int bound) {
    if (bound < 1) {
      throw new IllegalArgumentException("bound must be positive");
    }
    return (int) Long.remainderUnsigned(nextLong(), bound);
  }
}
