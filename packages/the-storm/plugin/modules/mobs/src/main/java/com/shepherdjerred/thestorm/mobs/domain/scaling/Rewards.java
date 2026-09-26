package com.shepherdjerred.thestorm.mobs.domain.scaling;

import java.util.random.RandomGenerator;

/**
 * Larger rewards for levelled mobs. Fractions round up with their own probability, so a 1.5 times
 * reward of 1 gives 1 or 2 equally often and averages 1.5.
 */
public final class Rewards {

  private Rewards() {}

  /** Experience for a mob that would drop {@code base}, with an {@link Stat#XP} bonus. */
  public static int xp(int base, double bonus, RandomGenerator random) {
    requireBonus(bonus);
    if (base < 0) {
      throw new IllegalArgumentException("base experience must not be negative: " + base);
    }
    return roundRandomly(base * (1 + bonus), random);
  }

  /**
   * The size of a dropped stack of {@code amount} with an {@link Stat#ITEM_DROPS} bonus. Only
   * stackable items grow, and never past a full stack: gear, tools and other single items are never
   * copied.
   */
  public static int dropAmount(int amount, int maxStack, double bonus, RandomGenerator random) {
    requireBonus(bonus);
    if (amount < 1 || maxStack < 1) {
      throw new IllegalArgumentException("need a positive amount and stack size");
    }
    if (maxStack == 1) {
      return amount;
    }
    return Math.min(maxStack, Math.max(amount, roundRandomly(amount * (1 + bonus), random)));
  }

  /** {@code value} rounded down, plus one with probability equal to its fraction. */
  static int roundRandomly(double value, RandomGenerator random) {
    var whole = Math.floor(value);
    var fraction = value - whole;
    var extra = fraction > 0 && random.nextDouble() < fraction ? 1 : 0;
    return (int) Math.min(Integer.MAX_VALUE, whole + extra);
  }

  private static void requireBonus(double bonus) {
    if (!(bonus >= 0) || Double.isInfinite(bonus)) {
      throw new IllegalArgumentException("bonus must not be negative: " + bonus);
    }
  }
}
