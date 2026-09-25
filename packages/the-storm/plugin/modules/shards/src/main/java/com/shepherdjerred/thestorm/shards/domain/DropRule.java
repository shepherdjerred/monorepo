package com.shepherdjerred.thestorm.shards.domain;

import java.util.OptionalInt;
import java.util.random.RandomGenerator;

/**
 * The chance that one mob kill or block break drops shards, and how many.
 *
 * @param chance probability of a drop, above 0 and at most 1
 * @param min the fewest shards a drop yields, at least 1
 * @param max the most shards a drop yields, at least {@code min}
 */
public record DropRule(double chance, int min, int max) {

  public DropRule {
    if (!(chance > 0 && chance <= 1)) {
      throw new IllegalArgumentException("chance must be above 0 and at most 1 but was " + chance);
    }
    if (min < 1) {
      throw new IllegalArgumentException("min must be at least 1 but was " + min);
    }
    if (max < min) {
      throw new IllegalArgumentException("max (" + max + ") must be at least min (" + min + ")");
    }
  }

  /** Rolls this rule once: the number of shards dropped, or empty when nothing drops. */
  public OptionalInt roll(RandomGenerator random) {
    if (random.nextDouble() >= chance) {
      return OptionalInt.empty();
    }
    return OptionalInt.of(min == max ? min : random.nextInt(min, max + 1));
  }
}
