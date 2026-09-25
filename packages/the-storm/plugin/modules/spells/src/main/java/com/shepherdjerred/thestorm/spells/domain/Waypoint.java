package com.shepherdjerred.thestorm.spells.domain;

/**
 * A player's Mark: where Recall returns them.
 *
 * @param world the world's key, for example {@code minecraft:overworld}
 */
public record Waypoint(String world, double x, double y, double z, float yaw, float pitch) {

  public Waypoint {
    if (world.isBlank()) {
      throw new IllegalArgumentException("a waypoint needs a world");
    }
    if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
      throw new IllegalArgumentException("a waypoint needs finite coordinates");
    }
  }
}
