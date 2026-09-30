package com.shepherdjerred.thestorm.shops.domain.shop;

import java.util.UUID;

/**
 * A block's position.
 *
 * @param world the world's id
 * @param x the block x
 * @param y the block y
 * @param z the block z
 */
public record BlockPos(UUID world, int x, int y, int z) {

  public BlockPos offset(int dx, int dy, int dz) {
    return new BlockPos(world, x + dx, y + dy, z + dz);
  }

  /** The horizontal neighbor on the {@code facing} side. */
  public BlockPos toward(Facing facing) {
    return offset(facing.dx(), 0, facing.dz());
  }
}
