package com.shepherdjerred.thestorm.skills.domain;

/** The capped, monotonic 1–1000 experience curve. Level zero means untrained. */
public final class Experience {

  public static final int MAX_LEVEL = 1000;
  private static final long BASE = 100;
  private static final long STEP = 10;

  private Experience() {}

  /** Total experience required to attain {@code level}. */
  public static long required(int level) {
    if (level < 0 || level > MAX_LEVEL) {
      throw new IllegalArgumentException("level must be between 0 and 1000");
    }
    return BASE * level + STEP * (long) level * (level - 1) / 2;
  }

  /** Finds the attained level without per-award iteration. */
  public static int level(long experience) {
    if (experience < 0) {
      throw new IllegalArgumentException("experience must be nonnegative");
    }
    int low = 0;
    int high = MAX_LEVEL;
    while (low < high) {
      int middle = (low + high + 1) / 2;
      if (required(middle) <= experience) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  }

  /** Adds a positive award and stops at the maximum level. */
  public static long award(long current, long amount) {
    if (current < 0 || amount <= 0) {
      throw new IllegalArgumentException("experience and award must be valid");
    }
    return Math.min(required(MAX_LEVEL), Math.addExact(current, amount));
  }
}
