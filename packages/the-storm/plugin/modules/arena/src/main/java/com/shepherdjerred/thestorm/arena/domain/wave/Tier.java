package com.shepherdjerred.thestorm.arena.domain.wave;

/**
 * A difficulty tier, from Ominous I to Ominous V. Each arena runs at one tier.
 *
 * @param name shown when a game starts, such as "Ominous III"
 * @param health multiplier on mob and boss health
 * @param damage multiplier on mob and boss damage
 * @param count multiplier on how many mobs spawn
 * @param reward multiplier on crystal rewards (the per-game cap still applies)
 */
public record Tier(String name, double health, double damage, double count, double reward) {

  public Tier {
    if (name.isBlank()) {
      throw new IllegalArgumentException("name must not be blank");
    }
    requireMultiplier("health", health);
    requireMultiplier("damage", damage);
    requireMultiplier("count", count);
    requireMultiplier("reward", reward);
  }

  private static void requireMultiplier(String what, double value) {
    if (!(value >= 0.1 && value <= 10)) {
      throw new IllegalArgumentException(what + " must be 0.1 to 10: " + value);
    }
  }
}
