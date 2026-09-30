package com.shepherdjerred.thestorm.arena.domain.geometry;

/**
 * One block, by its integer coordinates. Used for loot chests, class signs and the ready block.
 *
 * @param x east-west
 * @param y height
 * @param z north-south
 */
public record BlockPos(int x, int y, int z) {

  /** The centre of the block's top face, where something standing on it would be. */
  public Point center() {
    return new Point(x + 0.5, y, z + 0.5);
  }

  /** The chunk this block is in. */
  public ChunkPos chunk() {
    return new ChunkPos(Math.floorDiv(x, 16), Math.floorDiv(z, 16));
  }

  /** How this block is written in YAML, for error messages and {@code /arena here}. */
  public String describe() {
    return "{x: " + x + ", y: " + y + ", z: " + z + "}";
  }
}
