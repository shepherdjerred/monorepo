package com.shepherdjerred.thestorm.arena.domain.wave;

import java.util.List;

/**
 * A boss: one named mob with a health bar and abilities.
 *
 * @param mob the archetype the boss is built from (its type, equipment, scale and rider)
 * @param name shown above the boss and on its health bar
 * @param health max health for one player on the lowest tier, before scaling
 * @param bar the health bar's color
 * @param abilities what the boss does besides fight
 */
public record BossDefinition(
    String mob, String name, double health, BarColor bar, List<AbilitySpec> abilities) {

  public BossDefinition {
    if (name.isBlank()) {
      throw new IllegalArgumentException("name must not be blank");
    }
    if (!(health >= 1 && health <= WaveScaling.MAX_HEALTH)) {
      throw new IllegalArgumentException(
          "health must be 1 to " + WaveScaling.MAX_HEALTH + ": " + health);
    }
    var hearts = abilities.stream().filter(a -> a.type() == AbilityType.HEART).count();
    if (hearts > 1) {
      throw new IllegalArgumentException("a boss has at most one heart");
    }
    abilities = List.copyOf(abilities);
  }

  /** Whether the boss can only be hurt by breaking its heart. */
  public boolean hasHeart() {
    return abilities.stream().anyMatch(a -> a.type() == AbilityType.HEART);
  }
}
