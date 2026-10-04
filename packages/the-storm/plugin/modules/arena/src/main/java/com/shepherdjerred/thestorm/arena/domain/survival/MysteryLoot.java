package com.shepherdjerred.thestorm.arena.domain.survival;

/** Four disjoint reward pools keep useful equipment common and signature weapons scarce. */
public final class MysteryLoot {
  public enum Pool {
    BASIC,
    ENCHANTED,
    SPECIAL,
    LEGENDARY
  }

  private MysteryLoot() {}

  public static Pool pool(int roll) {
    if (roll < 0 || roll >= 100) throw new IllegalArgumentException("Invalid box roll");
    if (roll < 35) return Pool.BASIC;
    if (roll < 75) return Pool.ENCHANTED;
    return roll < 92 ? Pool.SPECIAL : Pool.LEGENDARY;
  }
}
