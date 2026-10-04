// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/map/WorldData.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.geometry;

/**
 * An axis-aligned block region, inclusive at both corners: Red Warfare's square map border.
 *
 * @param min the lowest corner
 * @param max the highest corner
 */
public record Cuboid(BlockPos min, BlockPos max) {

  public Cuboid {
    if (min.x() > max.x() || min.y() > max.y() || min.z() > max.z()) {
      throw new IllegalArgumentException("min must not exceed max: " + min + " > " + max);
    }
  }

  /** The region spanned by two corners in any order. */
  public static Cuboid spanning(BlockPos a, BlockPos b) {
    return new Cuboid(
        new BlockPos(Math.min(a.x(), b.x()), Math.min(a.y(), b.y()), Math.min(a.z(), b.z())),
        new BlockPos(Math.max(a.x(), b.x()), Math.max(a.y(), b.y()), Math.max(a.z(), b.z())));
  }

  public boolean contains(BlockPos block) {
    return block.x() >= min.x()
        && block.x() <= max.x()
        && block.y() >= min.y()
        && block.y() <= max.y()
        && block.z() >= min.z()
        && block.z() <= max.z();
  }

  public boolean contains(Vec3 point) {
    return contains(point.toBlock());
  }

  /**
   * The nearest point inside the border to {@code point}, which players outside it are moved to.
   * Points already inside come back unchanged.
   */
  public Vec3 clamp(Vec3 point) {
    return new Vec3(
        clamp(point.x(), min.x(), max.x() + 1),
        clamp(point.y(), min.y(), max.y() + 1),
        clamp(point.z(), min.z(), max.z() + 1));
  }

  private static double clamp(double value, double low, double highExclusive) {
    if (value < low) {
      return low + 0.5;
    }
    if (value >= highExclusive) {
      return highExclusive - 0.5;
    }
    return value;
  }
}
