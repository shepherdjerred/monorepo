package com.shepherdjerred.thestorm.mechanics.domain.grid;

import java.util.Optional;

/**
 * Read access to one world's blocks. Searches stay inside {@link #contains}: nothing is found,
 * placed or landed on outside the build height.
 */
public interface BlockGrid {

  /** What occupies {@code pos}. */
  Cell cellAt(Pos pos);

  /** The sign at {@code pos}, if there is one. */
  Optional<SignView> signAt(Pos pos);

  /** The lowest buildable y, inclusive. */
  int minY();

  /** The highest buildable y, exclusive. */
  int maxY();

  default boolean contains(Pos pos) {
    return pos.y() >= minY() && pos.y() < maxY();
  }
}
