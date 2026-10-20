package com.shepherdjerred.thestorm.creative.domain;

/**
 * Inclusive horizontal footprint of one plot, wall included and road excluded.
 *
 * @param id which plot
 * @param minX west edge
 * @param maxX east edge
 * @param minZ north edge
 * @param maxZ south edge
 */
public record PlotBounds(PlotId id, int minX, int maxX, int minZ, int maxZ) {

  public PlotBounds {
    if (minX > maxX || minZ > maxZ) {
      throw new IllegalArgumentException("plot bounds are inverted: " + id);
    }
  }

  /** Whether {@code (x, z)} is inside this plot, at any height. */
  public boolean contains(int x, int z) {
    return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  }

  /**
   * Blocks in this plot from {@code minY} through {@code maxY} inclusive. That is the largest
   * WorldEdit a member may run here.
   */
  public long columnVolume(int minY, int maxY) {
    if (minY > maxY) {
      throw new IllegalArgumentException("build height is inverted");
    }
    long width = (long) maxX - minX + 1;
    long depth = (long) maxZ - minZ + 1;
    return width * depth * ((long) maxY - minY + 1);
  }
}
