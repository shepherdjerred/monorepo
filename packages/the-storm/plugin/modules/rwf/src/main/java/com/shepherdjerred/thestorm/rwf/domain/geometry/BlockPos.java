package com.shepherdjerred.thestorm.rwf.domain.geometry;

/**
 * A block position.
 *
 * @param x east
 * @param y up
 * @param z south
 */
public record BlockPos(int x, int y, int z) {

  /** The centre of the block, as Red Warfare measured bomb distances. */
  public Vec3 center() {
    return new Vec3(x + 0.5, y + 0.5, z + 0.5);
  }

  /** The middle of the block's floor, where a spawn or a primed bomb stands. */
  public Vec3 floorCenter() {
    return new Vec3(x + 0.5, y, z + 0.5);
  }

  public BlockPos plus(int dx, int dy, int dz) {
    return new BlockPos(x + dx, y + dy, z + dz);
  }
}
