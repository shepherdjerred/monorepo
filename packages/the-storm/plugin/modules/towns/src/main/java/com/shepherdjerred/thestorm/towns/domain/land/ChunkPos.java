package com.shepherdjerred.thestorm.towns.domain.land;

import java.util.List;

/**
 * A 16×16 column of a world, the unit towns claim.
 *
 * @param world the world's name
 * @param x the chunk x coordinate (block x divided by 16, rounded down)
 * @param z the chunk z coordinate
 */
public record ChunkPos(String world, int x, int z) {

  public ChunkPos {
    if (world.isBlank()) {
      throw new IllegalArgumentException("world must not be blank");
    }
  }

  /** The chunk holding block ({@code blockX}, {@code blockZ}). */
  public static ChunkPos ofBlock(String world, int blockX, int blockZ) {
    return new ChunkPos(world, blockX >> 4, blockZ >> 4);
  }

  /** A packed key for chunk ({@code x}, {@code z}), unique within one world. */
  public static long key(int x, int z) {
    return ((long) x << 32) | (z & 0xFFFF_FFFFL);
  }

  /** This chunk's {@link #key(int, int)}. */
  public long key() {
    return key(x, z);
  }

  /** True when {@code other} shares an edge with this chunk; corners do not count. */
  public boolean isEdgeAdjacentTo(ChunkPos other) {
    return world.equals(other.world) && Math.abs(x - other.x) + Math.abs(z - other.z) == 1;
  }

  /** The four chunks sharing an edge with this one. */
  public List<ChunkPos> edgeNeighbours() {
    return List.of(
        new ChunkPos(world, x + 1, z),
        new ChunkPos(world, x - 1, z),
        new ChunkPos(world, x, z + 1),
        new ChunkPos(world, x, z - 1));
  }

  /** Every chunk at most {@code distance} chunks away on both axes, this one included. */
  public List<ChunkPos> square(int distance) {
    if (distance < 0) {
      throw new IllegalArgumentException("distance must not be negative: " + distance);
    }
    var side = 2 * distance + 1;
    var chunks = new java.util.ArrayList<ChunkPos>(side * side);
    for (var dx = -distance; dx <= distance; dx++) {
      for (var dz = -distance; dz <= distance; dz++) {
        chunks.add(new ChunkPos(world, x + dx, z + dz));
      }
    }
    return List.copyOf(chunks);
  }

  @Override
  public String toString() {
    return world + "(" + x + ", " + z + ")";
  }
}
