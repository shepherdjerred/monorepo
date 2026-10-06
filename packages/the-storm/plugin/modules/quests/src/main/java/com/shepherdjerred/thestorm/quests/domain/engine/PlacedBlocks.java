package com.shepherdjerred.thestorm.quests.domain.engine;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Blocks players placed recently, so breaking them again does not count for mine objectives
 * (place-and-break farming). Remembers the most recent {@code capacity} positions.
 */
public final class PlacedBlocks {

  private final Map<Position, Boolean> recent;

  public PlacedBlocks(int capacity) {
    if (capacity < 1) {
      throw new IllegalArgumentException("capacity must be positive");
    }
    this.recent =
        new LinkedHashMap<>(16, 0.75f, true) {
          @Override
          protected boolean removeEldestEntry(Map.Entry<Position, Boolean> eldest) {
            return size() > capacity;
          }
        };
  }

  /** A block position. */
  public record Position(String world, int x, int y, int z) {}

  /** A player placed a block at {@code position}. */
  public void placed(Position position) {
    recent.put(position, Boolean.TRUE);
  }

  /**
   * The block at {@code position} was broken; true if it counts as mined (nobody placed it
   * recently). Either way it is forgotten.
   */
  public boolean broken(Position position) {
    return recent.remove(position) == null;
  }
}
