package com.shepherdjerred.thestorm.rwfbots.domain.geom;

import java.util.OptionalDouble;

/** An axis-aligned box. */
public record AABB(Vec3 min, Vec3 max) {

  /** A standing player's half width. */
  public static final double PLAYER_HALF_WIDTH = 0.3;

  /** A standing player's height. */
  public static final double PLAYER_HEIGHT = 1.8;

  /** A sneaking player's height. */
  public static final double SNEAKING_HEIGHT = 1.5;

  public AABB {
    if (min.x() > max.x() || min.y() > max.y() || min.z() > max.z()) {
      throw new IllegalArgumentException("min must not exceed max: " + min + " > " + max);
    }
  }

  /** The box of a player whose feet are at {@code feet}. */
  public static AABB playerAt(Vec3 feet, boolean sneaking) {
    var height = sneaking ? SNEAKING_HEIGHT : PLAYER_HEIGHT;
    return new AABB(
        feet.plus(-PLAYER_HALF_WIDTH, 0, -PLAYER_HALF_WIDTH),
        feet.plus(PLAYER_HALF_WIDTH, height, PLAYER_HALF_WIDTH));
  }

  /** The unit cube of {@code cell}. */
  public static AABB ofCell(BlockPos cell) {
    return new AABB(
        new Vec3(cell.x(), cell.y(), cell.z()), new Vec3(cell.x() + 1, cell.y() + 1, cell.z() + 1));
  }

  public Vec3 center() {
    return min.lerp(max, 0.5);
  }

  public boolean contains(Vec3 point) {
    return point.x() >= min.x()
        && point.x() <= max.x()
        && point.y() >= min.y()
        && point.y() <= max.y()
        && point.z() >= min.z()
        && point.z() <= max.z();
  }

  public AABB expand(double amount) {
    return new AABB(min.plus(-amount, -amount, -amount), max.plus(amount, amount, amount));
  }

  /**
   * The distance along {@code direction} (a unit vector) from {@code origin} to where the ray first
   * enters this box, or empty if it misses. An origin inside the box gives zero.
   */
  public OptionalDouble rayEntry(Vec3 origin, Vec3 direction) {
    var near = Double.NEGATIVE_INFINITY;
    var far = Double.POSITIVE_INFINITY;
    double[] o = {origin.x(), origin.y(), origin.z()};
    double[] d = {direction.x(), direction.y(), direction.z()};
    double[] lo = {min.x(), min.y(), min.z()};
    double[] hi = {max.x(), max.y(), max.z()};
    for (var axis = 0; axis < 3; axis++) {
      if (Math.abs(d[axis]) < 1.0e-12) {
        if (o[axis] < lo[axis] || o[axis] > hi[axis]) {
          return OptionalDouble.empty();
        }
        continue;
      }
      var t1 = (lo[axis] - o[axis]) / d[axis];
      var t2 = (hi[axis] - o[axis]) / d[axis];
      near = Math.max(near, Math.min(t1, t2));
      far = Math.min(far, Math.max(t1, t2));
    }
    if (near > far || far < 0) {
      return OptionalDouble.empty();
    }
    return OptionalDouble.of(Math.max(near, 0));
  }
}
