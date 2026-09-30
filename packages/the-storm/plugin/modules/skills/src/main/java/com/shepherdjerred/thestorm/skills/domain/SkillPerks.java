package com.shepherdjerred.thestorm.skills.domain;

/** Small, bounded passive effects on top of persistent skill levels. */
public final class SkillPerks {

  private SkillPerks() {}

  /** Gathering and Fishing can yield one extra natural drop, up to a 25% chance. */
  public static double extraDropChance(int level) {
    valid(level);
    return level / 4000.0;
  }

  /** Combat skills add at most 10% damage against eligible mobs. */
  public static double combatDamageMultiplier(int level) {
    valid(level);
    return 1.0 + level / 10_000.0;
  }

  /** Acrobatics reduces fall damage by at most 25%. */
  public static double fallDamageMultiplier(int level) {
    valid(level);
    return 1.0 - level / 4000.0;
  }

  private static void valid(int level) {
    if (level < 0 || level > Experience.MAX_LEVEL) {
      throw new IllegalArgumentException("skill level must be between 0 and 1000");
    }
  }
}
