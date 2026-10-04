package com.shepherdjerred.thestorm.arena.domain.survival;

/** Behavior identifiers stay independent of item names, materials, and Pack-a-Punch tiers. */
public enum LegendaryWeapon {
  STORMCALLER,
  FROSTBITE,
  GRAVITON,
  REPEATER,
  WHIRLWIND,
  TIDEBREAKER,
  RIFTBLADE;

  public boolean special() {
    return switch (this) {
      case REPEATER, WHIRLWIND, TIDEBREAKER, RIFTBLADE -> true;
      case STORMCALLER, FROSTBITE, GRAVITON -> false;
    };
  }

  public String material() {
    return switch (this) {
      case STORMCALLER, REPEATER -> "BOW";
      case FROSTBITE -> "CROSSBOW";
      case GRAVITON -> "BLAZE_ROD";
      case WHIRLWIND -> "IRON_AXE";
      case TIDEBREAKER -> "TRIDENT";
      case RIFTBLADE -> "DIAMOND_SWORD";
    };
  }
}
