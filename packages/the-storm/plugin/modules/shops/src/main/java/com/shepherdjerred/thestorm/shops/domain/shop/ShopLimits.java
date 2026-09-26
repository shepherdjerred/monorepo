package com.shepherdjerred.thestorm.shops.domain.shop;

import static java.util.Objects.requireNonNull;

import java.util.Map;
import java.util.function.IntPredicate;

/**
 * How many chest shops a player may own at each Shopkeeper level. Untrained players (level 0) may
 * own none; every level allows at least as many as the one below it.
 *
 * @param byLevel the limit for each level from 1 to {@link #LEVELS}
 */
public record ShopLimits(Map<Integer, Integer> byLevel) {

  /** Shopkeeper levels, matching the tracks module's five levels. */
  public static final int LEVELS = 5;

  public ShopLimits {
    byLevel = Map.copyOf(byLevel);
    var previous = 0;
    for (var level = 1; level <= LEVELS; level++) {
      var limit = byLevel.get(level);
      if (limit == null) {
        throw new IllegalArgumentException("shop limits need a limit for level " + level);
      }
      if (limit < previous || limit < 1) {
        throw new IllegalArgumentException(
            "the shop limit for level "
                + level
                + " must be at least 1 and at least level "
                + (level - 1)
                + "'s");
      }
      previous = limit;
    }
    if (byLevel.size() != LEVELS) {
      throw new IllegalArgumentException("shop limits cover levels 1.." + LEVELS + " only");
    }
  }

  /** The most shops a player at {@code level} may own. */
  public int allowed(int level) {
    if (level < 0 || level > LEVELS) {
      throw new IllegalArgumentException("Shopkeeper levels are 0.." + LEVELS + ": " + level);
    }
    return level == 0 ? 0 : requireNonNull(byLevel.get(level));
  }

  /** The highest level {@code hasLevel} accepts, or 0; levels are granted cumulatively. */
  public static int highestLevel(IntPredicate hasLevel) {
    for (var level = LEVELS; level >= 1; level--) {
      if (hasLevel.test(level)) {
        return level;
      }
    }
    return 0;
  }
}
