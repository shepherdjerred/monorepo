package com.shepherdjerred.thestorm.arena.domain.geometry;

/**
 * Somewhere a player stands, facing a direction: the lobby, spawn points and the exit.
 *
 * @param x east-west
 * @param y height (feet)
 * @param z north-south
 * @param yaw facing, -180 to 180 degrees
 * @param pitch looking up or down, -90 to 90 degrees
 */
public record Spot(double x, double y, double z, float yaw, float pitch) {

  public Spot {
    if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
      throw new IllegalArgumentException("coordinates must be finite numbers");
    }
    if (yaw < -180 || yaw > 180) {
      throw new IllegalArgumentException("yaw must be -180 to 180: " + yaw);
    }
    if (pitch < -90 || pitch > 90) {
      throw new IllegalArgumentException("pitch must be -90 to 90: " + pitch);
    }
  }

  public Point point() {
    return new Point(x, y, z);
  }

  /** How this spot is written in YAML, for {@code /arena here}. */
  public String describe() {
    return "{x: " + x + ", y: " + y + ", z: " + z + ", yaw: " + yaw + ", pitch: " + pitch + "}";
  }
}
