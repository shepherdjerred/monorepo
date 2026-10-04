package com.shepherdjerred.thestorm.rwf.domain.geometry;

/**
 * Where a player is placed and which way they face.
 *
 * @param position the feet position
 * @param yaw degrees, 0 to 360 exclusive
 * @param pitch degrees, -90 to 90
 */
public record Spawn(Vec3 position, float yaw, float pitch) {

  public Spawn {
    if (!Float.isFinite(yaw) || yaw < 0 || yaw >= 360) {
      throw new IllegalArgumentException("yaw must be in [0, 360): " + yaw);
    }
    if (!Float.isFinite(pitch) || pitch < -90 || pitch > 90) {
      throw new IllegalArgumentException("pitch must be in [-90, 90]: " + pitch);
    }
  }

  /** A spawn standing in the middle of {@code block}, facing north. */
  public static Spawn at(BlockPos block) {
    return new Spawn(block.floorCenter(), 0, 0);
  }
}
