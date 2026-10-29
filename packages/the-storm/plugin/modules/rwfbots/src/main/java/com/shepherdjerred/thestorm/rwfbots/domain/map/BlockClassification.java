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

  /**
   * Which quarters of the top of the cell at world coordinates are a half step, only half a block
   * high, as a mask of {@link StairQuarters} bits: the lower half of a stair standing the right way
   * up. Zero for every other block, and by default, so a classification that cannot tell a stair's
   * facing climbs it by jumping as before.
   */
  default int halfStepQuarters(int x, int y, int z) {
    return 0;
  }
}
