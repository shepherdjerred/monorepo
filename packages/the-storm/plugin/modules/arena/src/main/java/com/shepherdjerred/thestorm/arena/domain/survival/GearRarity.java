package com.shepherdjerred.thestorm.arena.domain.survival;

/** Rarity describes equipment identity; augmentation is a separate progression axis. */
public enum GearRarity {
  COMMON,
  UNCOMMON,
  EPIC,
  LEGENDARY,
  MYTHIC;

  public boolean signature() {
    return this == LEGENDARY || this == MYTHIC;
  }

  public java.util.Optional<GearRarity> enchantNext() {
    return switch (this) {
      case COMMON -> java.util.Optional.of(UNCOMMON);
      case UNCOMMON -> java.util.Optional.of(EPIC);
      case EPIC, LEGENDARY, MYTHIC -> java.util.Optional.empty();
    };
  }

  public int primaryLevel() {
    return switch (this) {
      case COMMON -> 0;
      case UNCOMMON -> 2;
      case EPIC -> 4;
      case LEGENDARY, MYTHIC -> 5;
    };
  }

  public java.util.Map<String, Integer> enchantPrice() {
    return switch (this) {
      case COMMON -> java.util.Map.of("GLOWSTONE_DUST", 4, "EMERALD", 4);
      case UNCOMMON -> java.util.Map.of("GLOWSTONE_DUST", 8, "REDSTONE", 4, "EMERALD", 12);
      case EPIC, LEGENDARY, MYTHIC -> throw new IllegalStateException("Rarity cannot be crafted");
    };
  }
}
