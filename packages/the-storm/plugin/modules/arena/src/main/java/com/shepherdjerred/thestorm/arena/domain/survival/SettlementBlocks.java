package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import java.util.Map;

/** Bounded masonry primitives; every decorative state belongs to the reviewed arena volume. */
final class SettlementBlocks {
  private final Cuboid region;
  private final Map<BlockPos, String> blocks;

  SettlementBlocks(Cuboid region, Map<BlockPos, String> blocks) {
    this.region = region;
    this.blocks = blocks;
  }

  static BlockPos at(int x, int y, int z) {
    return new BlockPos(x, y, z);
  }

  void put(int x, int y, int z, String material) {
    var pos = at(x, y, z);
    if (!region.contains(pos))
      throw new IllegalArgumentException("Settlement exceeds footprint: " + pos);
    blocks.put(pos, material);
  }

  void box(BlockPos min, BlockPos max, String material) {
    for (var x = min.x(); x <= max.x(); x++)
      for (var z = min.z(); z <= max.z(); z++)
        for (var y = min.y(); y <= max.y(); y++) put(x, y, z, material);
  }

  void shell(BlockPos min, BlockPos max, String wall) {
    box(min, at(max.x(), min.y(), max.z()), "STONE_BRICKS");
    box(at(min.x(), min.y() + 1, min.z()), max, "AIR");
    for (var x = min.x(); x <= max.x(); x++) {
      box(at(x, min.y() + 1, min.z()), at(x, max.y(), min.z()), wall);
      box(at(x, min.y() + 1, max.z()), at(x, max.y(), max.z()), wall);
    }
    for (var z = min.z(); z <= max.z(); z++) {
      box(at(min.x(), min.y() + 1, z), at(min.x(), max.y(), z), wall);
      box(at(max.x(), min.y() + 1, z), at(max.x(), max.y(), z), wall);
    }
  }

  void door(BlockPos min, BlockPos max) {
    box(at(min.x(), min.y() + 1, min.z()), at(max.x(), max.y() + 4, max.z()), "AIR");
  }

  void roof(BlockPos min, BlockPos max, String material) {
    var middle = (min.x() + max.x()) / 2;
    for (var x = min.x(); x <= max.x(); x++) {
      var rise = Math.min(x - min.x(), max.x() - x);
      for (var z = min.z(); z <= max.z(); z++) {
        put(x, min.y() + rise, z, material);
        if (z == min.z() || z == max.z())
          box(at(x, min.y(), z), at(x, min.y() + rise - 1, z), "STRIPPED_SPRUCE_LOG");
      }
    }
    var top = min.y() + (max.x() - min.x()) / 2 + 1;
    box(at(middle, top, min.z()), at(middle, top, max.z()), material);
  }

  void lamp(int x, int z, int floor) {
    box(at(x, floor + 1, z), at(x, floor + 3, z), "STONE_BRICK_WALL");
    put(x, floor + 4, z, "LANTERN");
  }

  void tree(int x, int z, int floor) {
    box(at(x, floor + 1, z), at(x, floor + 5, z), "OAK_LOG");
    for (var dx = -3; dx <= 3; dx++)
      for (var dz = -3; dz <= 3; dz++)
        if (Math.abs(dx) + Math.abs(dz) <= 4)
          box(
              at(x + dx, floor + 5, z + dz),
              at(x + dx, floor + 7, z + dz),
              "minecraft:oak_leaves[persistent=true,distance=1]");
  }
}
