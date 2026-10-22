package com.shepherdjerred.thestorm.skylands.domain;

import java.util.OptionalInt;

/** One chunk of Skylands stone, in chunk-local x and z and Beta y {@code 0..127}. */
public final class IslandChunk {

  private final boolean[] solid;

  IslandChunk(boolean[] solid) {
    this.solid = solid;
  }

  /** Whether local {@code (x, y, z)} is stone. */
  public boolean solid(int x, int y, int z) {
    return solid[index(x, y, z)];
  }

  /** The highest stone in column {@code (x, z)}, or empty over the void. */
  public OptionalInt top(int x, int z) {
    for (var y = SkyTerrain.HEIGHT - 1; y >= 0; y--) {
      if (solid[index(x, y, z)]) {
        return OptionalInt.of(y);
      }
    }
    return OptionalInt.empty();
  }

  /** Contiguous stone from {@code y} downward, including {@code y}. */
  public int depthBelow(int x, int y, int z) {
    var depth = 0;
    for (var below = y; below >= 0 && solid[index(x, below, z)]; below--) {
      depth++;
    }
    return depth;
  }

  /** Stone blocks in the whole chunk. */
  public int volume() {
    var count = 0;
    for (var block : solid) {
      if (block) {
        count++;
      }
    }
    return count;
  }

  private static int index(int x, int y, int z) {
    if (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y >= SkyTerrain.HEIGHT) {
      throw new IndexOutOfBoundsException("outside the chunk: " + x + "," + y + "," + z);
    }
    return (x << 11) | (z << 7) | y;
  }
}
