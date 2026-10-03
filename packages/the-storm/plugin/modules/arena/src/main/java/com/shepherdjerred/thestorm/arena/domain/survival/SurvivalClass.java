package com.shepherdjerred.thestorm.arena.domain.survival;

/** Horizontal roles unlocked by persistent survival experience. */
public enum SurvivalClass {
  FIGHTER(0),
  RANGER(0),
  MEDIC(0),
  ENGINEER(500),
  ALCHEMIST(1500),
  BEASTMASTER(3000);

  private final int requiredXp;

  SurvivalClass(int requiredXp) {
    this.requiredXp = requiredXp;
  }

  public int requiredXp() {
    return requiredXp;
  }

  public boolean unlocked(long xp) {
    return xp >= requiredXp;
  }
}
