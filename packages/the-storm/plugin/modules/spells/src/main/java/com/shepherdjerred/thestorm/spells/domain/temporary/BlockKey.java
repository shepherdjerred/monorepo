package com.shepherdjerred.thestorm.spells.domain.temporary;

import com.shepherdjerred.thestorm.spells.domain.geometry.BlockPos;

/**
 * A block in a world, the identity of a temporary block.
 *
 * @param world the world's key, for example {@code minecraft:overworld}
 */
public record BlockKey(String world, int x, int y, int z) {

  public BlockKey {
    if (world.isBlank()) {
      throw new IllegalArgumentException("a block key needs a world");
    }
  }

  public static BlockKey of(String world, BlockPos pos) {
    return new BlockKey(world, pos.x(), pos.y(), pos.z());
  }

  public BlockPos pos() {
    return new BlockPos(x, y, z);
  }
}
