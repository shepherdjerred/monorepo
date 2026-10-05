package com.shepherdjerred.thestorm.arena.domain.survival;

/** Signature equipment behaviors stay independent of display names and augmentation levels. */
public enum LegendaryWeapon {
  STORMCALLER,
  FROSTBITE,
  GRAVITON,
  REPEATER,
  WHIRLWIND,
  TIDEBREAKER,
  RIFTBLADE,
  COPPERGUARD,
  BRIARPLATE,
  TRAILWARDEN,
  STORMGLASS,
  WAYFARER,
  ECHOHEART,
  FAULTLINE;

  public GearRarity rarity() {
    return switch (this) {
      case STORMGLASS, WAYFARER, ECHOHEART, FAULTLINE -> GearRarity.MYTHIC;
      default -> GearRarity.LEGENDARY;
    };
  }

  public String material() {
    return switch (this) {
      case STORMCALLER, REPEATER, STORMGLASS -> "BOW";
      case FROSTBITE -> "CROSSBOW";
      case GRAVITON -> "BLAZE_ROD";
      case WHIRLWIND -> "IRON_AXE";
      case TIDEBREAKER -> "TRIDENT";
      case RIFTBLADE, WAYFARER -> "DIAMOND_SWORD";
      case COPPERGUARD, FAULTLINE -> "SHIELD";
      case BRIARPLATE, ECHOHEART -> "DIAMOND_CHESTPLATE";
      case TRAILWARDEN -> "DIAMOND_BOOTS";
    };
  }
}
