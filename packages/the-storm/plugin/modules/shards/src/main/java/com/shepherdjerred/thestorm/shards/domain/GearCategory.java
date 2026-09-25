package com.shepherdjerred.thestorm.shards.domain;

/**
 * The kinds of gear the altar can upgrade. Weapons raise damage dealt; armor lowers damage taken.
 */
public enum GearCategory {
  SWORD(true, false),
  AXE(true, false),
  MACE(true, false),
  SPEAR(true, false),
  TRIDENT(true, true),
  BOW(false, true),
  CROSSBOW(false, true),
  HELMET(false, false),
  CHESTPLATE(false, false),
  LEGGINGS(false, false),
  BOOTS(false, false);

  private final boolean melee;
  private final boolean ranged;

  GearCategory(boolean melee, boolean ranged) {
    this.melee = melee;
    this.ranged = ranged;
  }

  /** Whether this gear strengthens {@code attack}. A trident counts both in hand and thrown. */
  public boolean boosts(Attack attack) {
    return switch (attack) {
      case MELEE -> melee;
      case PROJECTILE -> ranged;
    };
  }

  /** Whether this is armor, which reduces damage taken instead of raising damage dealt. */
  public boolean isArmor() {
    return !melee && !ranged;
  }
}
