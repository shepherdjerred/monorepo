package com.shepherdjerred.thestorm.mechanics.domain.grid;

import java.util.Optional;

/**
 * Read access to one world's blocks. Searches stay inside {@link #contains}: nothing is found,
 * placed or landed on outside the build height, outside the world border or in unloaded chunks.
 */
public interface BlockGrid {

  /** What occupies {@code pos}; {@link Cell#unloaded()} where the chunk is not loaded. */
  Cell cellAt(Pos pos);

  /** The sign at {@code pos}, if there is one. */
  Optional<SignView> signAt(Pos pos);

  /**
   * Whether removing the block at {@code pos} would break something attached to it or resting on
   * it: a sign, torch, lever, button, ladder, rail, carpet, item frame or painting. Mechanisms
   * never remove such a block, so nothing ever pops off as a side effect of a toggle.
   */
  boolean supports(Pos pos);

  /** The lowest buildable y, inclusive. */
  int minY();

  /** The highest buildable y, exclusive. */
  int maxY();

  /** Whether mechanisms may look at and change {@code pos}. */
  default boolean contains(Pos pos) {
    return pos.y() >= minY() && pos.y() < maxY();
  }
}
