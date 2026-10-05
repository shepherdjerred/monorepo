package com.shepherdjerred.thestorm.arena.domain.survival;

/** Explicit rarity odds keep dependable crafting alongside exciting signature equipment. */
public final class MysteryLoot {
  private MysteryLoot() {}

  public static GearRarity rarity(int roll) {
    if (roll < 0 || roll >= 100) throw new IllegalArgumentException("Invalid box roll");
    if (roll < 25) return GearRarity.COMMON;
    if (roll < 55) return GearRarity.UNCOMMON;
    if (roll < 80) return GearRarity.EPIC;
    return roll < 96 ? GearRarity.LEGENDARY : GearRarity.MYTHIC;
  }
}
