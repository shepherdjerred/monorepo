package com.shepherdjerred.thestorm.mobs.domain.level;

/**
 * A mob's level and how it was reached.
 *
 * @param distanceLevel the level drawn from the distance band
 * @param depthBonus levels added for spawning underground
 * @param moonBonus levels added by the moon at night
 * @param level the final level: the sum, kept between 1 and the cap
 */
public record Levelled(int distanceLevel, int depthBonus, int moonBonus, int level) {

  public Levelled {
    if (level < 1) {
      throw new IllegalArgumentException("level must be at least 1: " + level);
    }
  }
}
