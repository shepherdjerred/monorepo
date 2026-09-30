package com.shepherdjerred.thestorm.spells.domain.geometry;

import java.util.HashMap;
import java.util.Map;

/**
 * A fake world for the safe-spot search: a flat floor of solid blocks at y=63 (so standing height
 * is y=64), open air above, and whatever blocks a test sets. Below y=0 is the void.
 */
final class Grid implements BlockProbe {

  static final int FLOOR = 63;

  private final Map<BlockPos, Footing> blocks = new HashMap<>();
  private final boolean floor;

  private Grid(boolean floor) {
    this.floor = floor;
  }

  /** Flat ground at y=63. */
  static Grid flat() {
    return new Grid(true);
  }

  /** Nothing but air (and void below 0). */
  static Grid sky() {
    return new Grid(false);
  }

  Grid set(int x, int y, int z, Footing footing) {
    blocks.put(new BlockPos(x, y, z), footing);
    return this;
  }

  /** A solid column from the floor up to {@code top}, like a wall slice. */
  Grid pillar(int x, int z, int top) {
    for (var y = FLOOR + 1; y <= top; y++) {
      set(x, y, z, Footing.SOLID);
    }
    return this;
  }

  @Override
  public Footing at(BlockPos pos) {
    if (pos.y() < 0) {
      return Footing.HAZARD;
    }
    var set = blocks.get(pos);
    if (set != null) {
      return set;
    }
    return floor && pos.y() <= FLOOR ? Footing.SOLID : Footing.OPEN;
  }
}
