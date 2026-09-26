package com.shepherdjerred.thestorm.arena.domain.snapshot;

/**
 * Where a player stood, in a named world.
 *
 * @param world the world's name
 * @param x east-west
 * @param y height
 * @param z north-south
 * @param yaw facing
 * @param pitch looking up or down
 */
public record Position(String world, double x, double y, double z, float yaw, float pitch) {

  public Position {
    if (world.isBlank()) {
      throw new IllegalArgumentException("world must not be blank");
    }
  }
}
