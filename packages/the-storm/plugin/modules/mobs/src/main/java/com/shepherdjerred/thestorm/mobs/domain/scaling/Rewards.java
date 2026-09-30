package com.shepherdjerred.thestorm.mobs.domain.scaling;

import java.util.random.RandomGenerator;

/**
 * Larger rewards for levelled mobs. Fractions round up with their own probability, so a 1.5 times
 * reward of 1 gives 1 or 2 equally often and averages 1.5.
 *
 * <p>Rewards are only paid for a fair kill ({@link #earned}), and extra items only ever come from
 * extra rolls of the mob's own loot table: what the mob carried or picked up is never multiplied.
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
   * How many extra times the mob's loot table is rolled for an {@link Stat#ITEM_DROPS} bonus: a
   * bonus of 0.4 rolls once 40% of the time, 1.5 rolls once or twice.
   */
  public static int extraRolls(double bonus, RandomGenerator random) {
    requireBonus(bonus);
    return roundRandomly(bonus, random);
  }

  /**
   * Whether a kill earns the level's rewards: players dealt most of the damage (more than
   * everything else together) and a player struck the final blow in melee or with a projectile.
   * Kill chambers, fall traps, lava and pets doing the work pay vanilla.
   *
   * @param playerDamage damage dealt by players' own hits and projectiles
   * @param otherDamage damage from everything else
   * @param playerFinalBlow whether the killing blow was a player's hit or projectile
   */
  public static boolean earned(double playerDamage, double otherDamage, boolean playerFinalBlow) {
    if (!(playerDamage >= 0) || !(otherDamage >= 0)) {
      throw new IllegalArgumentException("damage must not be negative");
    }
    return playerFinalBlow && playerDamage > otherDamage;
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
