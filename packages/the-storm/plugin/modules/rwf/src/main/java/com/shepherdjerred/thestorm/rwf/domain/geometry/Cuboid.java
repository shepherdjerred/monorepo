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
   * Whether {@code point} stands within the border's columns: X and Z only, at any height. Red
   * Warfare's square border never limited height; falling below the map is the void's job.
   */
  public boolean containsColumn(Vec3 point) {
    var block = point.toBlock();
    return block.x() >= min.x()
        && block.x() <= max.x()
        && block.z() >= min.z()
        && block.z() <= max.z();
  }

  /** Whether {@code point} is more than {@code margin} blocks below the bottom of the region. */
  public boolean below(Vec3 point, int margin) {
    if (margin < 0) {
      throw new IllegalArgumentException("margin must not be negative: " + margin);
    }
    return point.y() < min.y() - margin;
  }
}
