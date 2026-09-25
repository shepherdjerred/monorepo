package com.shepherdjerred.thestorm.qol.domain.rtp;

/** A block column, x and z. */
public record BlockPoint(int x, int z) {

  /** Euclidean distance to {@code other}, rounded down. */
  public int distanceTo(BlockPoint other) {
    long dx = (long) x - other.x;
    long dz = (long) z - other.z;
    return (int) Math.sqrt((double) (dx * dx + dz * dz));
  }

  /** Chunk x of this block. */
  public int chunkX() {
    return x >> 4;
  }

  /** Chunk z of this block. */
  public int chunkZ() {
    return z >> 4;
  }
}
