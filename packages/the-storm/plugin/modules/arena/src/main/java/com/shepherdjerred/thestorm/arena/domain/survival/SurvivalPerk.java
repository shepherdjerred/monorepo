package com.shepherdjerred.thestorm.arena.domain.survival;

/** Physical machines sell these run-scoped upgrades. */
public enum SurvivalPerk {
  JUGGERNOG(24),
  STAMIN_UP(20),
  DOUBLE_TAP(32),
  QUICK_REVIVE(16);
  private final int price;

  SurvivalPerk(int price) {
    this.price = price;
  }

  public int price() {
    return price;
  }
}
