package com.shepherdjerred.thestorm.arena.domain.geometry;

import java.util.ArrayList;
import java.util.List;

/**
 * A box of blocks, both corners included. Every coordinate of {@code min} must be at most the same
 * coordinate of {@code max}.
 *
 * @param min the lowest corner
 * @param max the highest corner
 */
public record Cuboid(BlockPos min, BlockPos max) {

  public Cuboid {
    if (min.x() > max.x() || min.y() > max.y() || min.z() > max.z()) {
      throw new IllegalArgumentException(
          "min " + min.describe() + " must not exceed max " + max.describe() + " on any axis");
    }
  }

  public boolean contains(BlockPos block) {
    return block.x() >= min.x()
        && block.x() <= max.x()
        && block.y() >= min.y()
        && block.y() <= max.y()
        && block.z() >= min.z()
        && block.z() <= max.z();
  }

  public boolean contains(Point point) {
    return contains(point.block());
  }

  /** Every chunk the box touches, for keeping the arena loaded while a game runs. */
  public List<ChunkPos> chunks() {
    var low = min.chunk();
    var high = max.chunk();
    var chunks = new ArrayList<ChunkPos>();
    for (var x = low.x(); x <= high.x(); x++) {
      for (var z = low.z(); z <= high.z(); z++) {
        chunks.add(new ChunkPos(x, z));
      }
    }
    return List.copyOf(chunks);
  }

  /** The point in the middle of the box's floor. */
  public Point floorCenter() {
    return new Point((min.x() + max.x() + 1) / 2.0, min.y(), (min.z() + max.z() + 1) / 2.0);
  }
}
