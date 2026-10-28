package com.shepherdjerred.thestorm.skylands.domain;

import java.util.Arrays;
import java.util.OptionalInt;

/** Immutable chunk of layered density; no mutable buffer escapes generation. */
public final class LayeredChunk {
  private final boolean[] blocks;

  LayeredChunk(boolean[] blocks) {
    this.blocks = blocks;
  }

  public boolean solid(int x, int y, int z) {
    if (x < 0 || x > 15 || z < 0 || z > 15) {
      throw new IndexOutOfBoundsException("Outside chunk column: " + x + "," + z);
    }
    return y >= LayeredNoise.MIN_Y
        && y < LayeredNoise.MIN_Y + LayeredNoise.HEIGHT
        && blocks[(x * 16 + z) * LayeredNoise.HEIGHT + y - LayeredNoise.MIN_Y];
  }

  public OptionalInt top(int x, int z) {
    for (var y = LayeredNoise.MIN_Y + LayeredNoise.HEIGHT - 1; y >= LayeredNoise.MIN_Y; y--) {
      if (solid(x, y, z)) return OptionalInt.of(y);
    }
    return OptionalInt.empty();
  }

  public int fingerprint() {
    return Arrays.hashCode(blocks);
  }
}
