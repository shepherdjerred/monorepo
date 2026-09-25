package com.shepherdjerred.thestorm.spells.domain.geometry;

/** A point or direction in world space. */
public record Vec3(double x, double y, double z) {

  public static final Vec3 ZERO = new Vec3(0, 0, 0);

  public static final Vec3 UP = new Vec3(0, 1, 0);

  public Vec3 plus(Vec3 other) {
    return new Vec3(x + other.x, y + other.y, z + other.z);
  }

  public Vec3 minus(Vec3 other) {
    return new Vec3(x - other.x, y - other.y, z - other.z);
  }

  public Vec3 times(double factor) {
    return new Vec3(x * factor, y * factor, z * factor);
  }

  public double length() {
    return Math.sqrt(x * x + y * y + z * z);
  }

  public double distance(Vec3 other) {
    return minus(other).length();
  }

  /** This vector flattened onto the horizontal plane. */
  public Vec3 horizontal() {
    return new Vec3(x, 0, z);
  }

  /** A unit vector in this direction, or zero for the zero vector. */
  public Vec3 normalized() {
    var length = length();
    return length < 1.0e-9 ? ZERO : times(1 / length);
  }

  /**
   * The direction a player faces, using Minecraft's angles: yaw 0 faces south (+z), 90 faces west
   * (-x); pitch -90 looks straight up.
   */
  public static Vec3 facing(float yaw, float pitch) {
    var yawRadians = Math.toRadians(yaw);
    var pitchRadians = Math.toRadians(pitch);
    var horizontal = Math.cos(pitchRadians);
    return new Vec3(
        -Math.sin(yawRadians) * horizontal,
        -Math.sin(pitchRadians),
        Math.cos(yawRadians) * horizontal);
  }
}
