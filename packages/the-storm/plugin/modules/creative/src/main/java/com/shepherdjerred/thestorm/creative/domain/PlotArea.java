package com.shepherdjerred.thestorm.creative.domain;

/**
 * Inclusive horizontal rectangle. A plot footprint and the road between two merged plots are both
 * areas. The road is not a plot, so this has no plot id.
 */
public record PlotArea(int minX, int maxX, int minZ, int maxZ) {

  public PlotArea {
    if (minX > maxX || minZ > maxZ) {
      throw new IllegalArgumentException("plot area is inverted");
    }
  }

  public static PlotArea of(PlotBounds bounds) {
    return new PlotArea(bounds.minX(), bounds.maxX(), bounds.minZ(), bounds.maxZ());
  }

  /** Whether {@code (x, z)} is inside this rectangle. */
  public boolean contains(int x, int z) {
    return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  }

  /** Blocks in this rectangle from {@code minY} through {@code maxY} inclusive. */
  public long columnVolume(int minY, int maxY) {
    if (minY > maxY) {
      throw new IllegalArgumentException("build height is inverted");
    }
    long width = (long) maxX - minX + 1;
    long depth = (long) maxZ - minZ + 1;
    return width * depth * ((long) maxY - minY + 1);
  }
}
