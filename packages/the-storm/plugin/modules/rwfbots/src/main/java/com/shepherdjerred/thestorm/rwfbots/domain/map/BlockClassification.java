package com.shepherdjerred.thestorm.rwfbots.domain.map;

/**
 * The baker's input: every cell of a map sorted into a {@link BlockShape} and whether it blocks
 * sight. The adapter implements this over a world; tests implement it over arrays.
 */
public interface BlockClassification {

  GridBounds bounds();

  /** The shape class of the cell at world coordinates, which must be inside the bounds. */
  BlockShape shape(int x, int y, int z);

  /** Whether the cell at world coordinates blocks sight (glass does not; stone does). */
  boolean blocksSight(int x, int y, int z);
}
