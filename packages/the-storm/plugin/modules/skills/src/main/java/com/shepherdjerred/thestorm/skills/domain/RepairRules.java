package com.shepherdjerred.thestorm.skills.domain;

/** Durability restored by one matching repair ingredient. */
public final class RepairRules {
  private RepairRules() {}

  public static int amount(int maxDurability, int level) {
    if (maxDurability <= 0 || level < 0 || level > Experience.MAX_LEVEL) {
      throw new IllegalArgumentException("invalid repair input");
    }
    return Math.max(1, maxDurability * (25 + level / 40) / 100);
  }
}
