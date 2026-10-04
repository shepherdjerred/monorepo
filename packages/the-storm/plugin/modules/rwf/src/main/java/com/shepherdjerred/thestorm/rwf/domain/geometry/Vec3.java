package com.shepherdjerred.thestorm.rwf.domain.geometry;

/**
 * A point or velocity in world space.
 *
 * @param x east
 * @param y up
 * @param z south
 */
public record Vec3(double x, double y, double z) {

  public static final Vec3 ZERO = new Vec3(0, 0, 0);

  public Vec3 {
    if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
      throw new IllegalArgumentException("coordinates must be finite: " + x + "," + y + "," + z);
    }
  }

  public Vec3 plus(Vec3 other) {
    return new Vec3(x + other.x, y + other.y, z + other.z);
  }

  public Vec3 minus(Vec3 other) {
    return new Vec3(x - other.x, y - other.y, z - other.z);
  }

  public Vec3 scaled(double factor) {
    return new Vec3(x * factor, y * factor, z * factor);
  }

  public Vec3 withY(double newY) {
    return new Vec3(x, newY, z);
  }

  public double length() {
    return Math.sqrt(x * x + y * y + z * z);
  }

  public double distanceTo(Vec3 other) {
    return minus(other).length();
  }

  /** The block this point is inside. */
  public BlockPos toBlock() {
    return new BlockPos((int) Math.floor(x), (int) Math.floor(y), (int) Math.floor(z));
  }
}
