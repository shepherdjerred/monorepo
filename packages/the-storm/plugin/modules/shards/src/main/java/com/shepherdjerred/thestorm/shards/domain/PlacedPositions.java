package com.shepherdjerred.thestorm.shards.domain;

import java.util.Arrays;

/**
 * The set of player-placed source blocks in one chunk, stored as packed positions in an {@code
 * int[]} (the adapter keeps it in the chunk's persistent data). Operations return new arrays and
 * never modify their input.
 */
public final class PlacedPositions {

  private static final int[] EMPTY = {};

  private PlacedPositions() {}

  /** The empty set. */
  public static int[] none() {
    return EMPTY.clone();
  }

  /**
   * Packs a block position into one int, unique within a chunk: the chunk-local x and z (0..15) in
   * the low eight bits and the signed y above them.
   */
  public static int pack(int x, int y, int z) {
    return (y << 8) | ((x & 15) << 4) | (z & 15);
  }

  public static boolean contains(int[] positions, int packed) {
    for (var position : positions) {
      if (position == packed) {
        return true;
      }
    }
    return false;
  }

  /** {@code positions} with {@code packed} added; the same contents if it was already there. */
  public static int[] with(int[] positions, int packed) {
    if (contains(positions, packed)) {
      return positions.clone();
    }
    var result = Arrays.copyOf(positions, positions.length + 1);
    result[positions.length] = packed;
    return result;
  }

  /** {@code positions} without {@code packed}. */
  public static int[] without(int[] positions, int packed) {
    return Arrays.stream(positions).filter(position -> position != packed).toArray();
  }
}
