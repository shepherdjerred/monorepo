package com.shepherdjerred.thestorm.npcs.domain.geo;

/** A point or offset in block coordinates. */
public record Vec3(double x, double y, double z) {

  public Vec3 {
    if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
      throw new IllegalArgumentException("coordinates must be finite: " + x + ", " + y + ", " + z);
    }
  }

  public Vec3 plus(Vec3 other) {
    return new Vec3(x + other.x, y + other.y, z + other.z);
  }

  public Vec3 minus(Vec3 other) {
    return new Vec3(x - other.x, y - other.y, z - other.z);
  }

  public Vec3 scale(double factor) {
    return new Vec3(x * factor, y * factor, z * factor);
  }

  public double length() {
    return Math.sqrt(x * x + y * y + z * z);
  }

  public double distance(Vec3 other) {
    return minus(other).length();
  }

  /** The distance ignoring height. */
  public double horizontalDistance(Vec3 other) {
    var dx = x - other.x;
    var dz = z - other.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * The point {@code step} blocks from here towards {@code target}, or {@code target} if closer.
   */
  public Vec3 towards(Vec3 target, double step) {
    var delta = target.minus(this);
    var distance = delta.length();
    if (distance <= step) {
      return target;
    }
    return plus(delta.scale(step / distance));
  }
}
