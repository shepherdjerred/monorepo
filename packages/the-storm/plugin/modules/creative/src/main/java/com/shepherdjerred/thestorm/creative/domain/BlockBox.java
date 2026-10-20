package com.shepherdjerred.thestorm.creative.domain;

/**
 * Inclusive block box. WorldEdit selections arrive as two opposite corners; this is those corners
 * sorted.
 */
public record BlockBox(int minX, int minY, int minZ, int maxX, int maxY, int maxZ) {

  public BlockBox {
    if (minX > maxX || minY > maxY || minZ > maxZ) {
      throw new IllegalArgumentException("selection is inverted");
    }
  }

  /** Blocks in the box, inclusive. */
  public long volume() {
    return (long) (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
  }
}
