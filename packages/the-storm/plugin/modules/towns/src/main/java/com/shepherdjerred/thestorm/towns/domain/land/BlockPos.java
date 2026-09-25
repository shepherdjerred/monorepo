package com.shepherdjerred.thestorm.towns.domain.land;

/**
 * One block of a world.
 *
 * @param world the world's name
 * @param x block x
 * @param y block y
 * @param z block z
 */
public record BlockPos(String world, int x, int y, int z) {

  public BlockPos {
    if (world.isBlank()) {
      throw new IllegalArgumentException("world must not be blank");
    }
  }

  /** The chunk this block is in. */
  public ChunkPos chunk() {
    return ChunkPos.ofBlock(world, x, z);
  }
}
