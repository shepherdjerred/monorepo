package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/** Actual supported feet height, shared by topology metadata and offline launch certification. */
final class BlockFeet {
  private BlockFeet() {}

  static byte halfOffset(BlockClassification blocks, BlockPos cell) {
    var below = cell.down();
    if (!blocks.bounds().contains(below) || blocks.shape(cell.x(), cell.y(), cell.z()).swim())
      return 0;
    return (byte)
        (blocks.shape(below.x(), below.y(), below.z()) == BlockShape.SLAB_BOTTOM ? -1 : 0);
  }

  static Vec3 at(BlockClassification blocks, BlockPos cell) {
    return cell.feet().plus(0, halfOffset(blocks, cell) * 0.5, 0);
  }
}
