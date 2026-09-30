package com.shepherdjerred.thestorm.essentials.domain.place;

/**
 * A point and facing in a named world. The domain's stand-in for Paper's {@code Location}.
 *
 * @param world the world's name
 * @param x block x, fractional
 * @param y block y, fractional
 * @param z block z, fractional
 * @param yaw horizontal facing in degrees
 * @param pitch vertical facing in degrees
 */
public record Position(String world, double x, double y, double z, float yaw, float pitch) {

  public Position {
    if (world.isBlank()) {
      throw new IllegalArgumentException("world must not be blank");
    }
    if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
      throw new IllegalArgumentException("coordinates must be finite");
    }
    if (!Float.isFinite(yaw) || !Float.isFinite(pitch)) {
      throw new IllegalArgumentException("yaw and pitch must be finite");
    }
    if (pitch < -90 || pitch > 90) {
      throw new IllegalArgumentException("pitch must be between -90 and 90: " + pitch);
    }
  }

  /** A short human-readable form, for example {@code world 12, 64, -30}. */
  public String describe() {
    return world
        + " "
        + Math.round(Math.floor(x))
        + ", "
        + Math.round(Math.floor(y))
        + ", "
        + Math.round(Math.floor(z));
  }
}
