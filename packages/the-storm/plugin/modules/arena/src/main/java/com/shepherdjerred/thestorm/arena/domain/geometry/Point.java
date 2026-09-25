package com.shepherdjerred.thestorm.arena.domain.geometry;

/**
 * A position in a world, in blocks. Used for mob spawns and boss targeting, where facing does not
 * matter.
 *
 * @param x east-west
 * @param y height
 * @param z north-south
 */
public record Point(double x, double y, double z) {

  public Point {
    if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
      throw new IllegalArgumentException("coordinates must be finite numbers");
    }
  }

  /** The block this point lies in. */
  public BlockPos block() {
    return new BlockPos((int) Math.floor(x), (int) Math.floor(y), (int) Math.floor(z));
  }

  public double distanceSquared(Point other) {
    var dx = x - other.x;
    var dy = y - other.y;
    var dz = z - other.z;
    return dx * dx + dy * dy + dz * dz;
  }

  public double distance(Point other) {
    return Math.sqrt(distanceSquared(other));
  }
}
