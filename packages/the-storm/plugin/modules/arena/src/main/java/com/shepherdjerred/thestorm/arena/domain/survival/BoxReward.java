package com.shepherdjerred.thestorm.arena.domain.survival;

import java.util.Optional;

/** A reveal is one immutable equipment reward, independent of its eventual item representation. */
public record BoxReward(String material, GearRarity rarity, Optional<LegendaryWeapon> effect) {
  public BoxReward {
    if (material.isBlank()
        || rarity.signature() != effect.isPresent()
        || effect.filter(e -> !e.material().equals(material) || e.rarity() != rarity).isPresent())
      throw new IllegalArgumentException("Invalid box equipment reward");
  }

  public static BoxReward ordinary(String material, GearRarity rarity) {
    return new BoxReward(material, rarity, Optional.empty());
  }

  public static BoxReward signature(LegendaryWeapon effect) {
    return new BoxReward(effect.material(), effect.rarity(), Optional.of(effect));
  }
}
