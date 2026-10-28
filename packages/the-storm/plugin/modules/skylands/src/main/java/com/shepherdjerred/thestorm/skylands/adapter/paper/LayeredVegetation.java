package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.SkyBounds;
import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.Tag;

/**
 * Clear intersecting vegetation before a piece is built; never touch another chunk or player edits.
 */
final class LayeredVegetation {
  private final LayeredBlocks blocks;

  LayeredVegetation(LayeredBlocks blocks) {
    this.blocks = blocks;
  }

  void clear(LayeredSlice slice, SkyPosition spawn) {
    for (var piece : slice.plan().pieces()) {
      var origin = piece.origin();
      var size = piece.size();
      clear(
          slice,
          new SkyBounds(
              origin.above(1),
              origin.add(
                  new SkyPosition(size.x() - 1, Math.min(size.y() + 18, 64), size.z() - 1))));
    }
    clear(
        slice,
        new SkyBounds(spawn.add(new SkyPosition(-2, 0, -2)), spawn.add(new SkyPosition(2, 18, 2))));
  }

  private void clear(LayeredSlice slice, SkyBounds box) {
    if (!box.containsChunk(slice.x(), slice.z())) return;
    for (var x = Math.max(slice.x() * 16, box.min().x());
        x <= Math.min(slice.x() * 16 + 15, box.max().x());
        x++) {
      for (var z = Math.max(slice.z() * 16, box.min().z());
          z <= Math.min(slice.z() * 16 + 15, box.max().z());
          z++) {
        column(slice, new SkyPosition(x, box.min().y(), z), box.max().y());
      }
    }
  }

  private void column(LayeredSlice slice, SkyPosition p, int top) {
    for (var y = p.y(); y <= Math.min(319, top); y++) {
      var type = slice.region().getType(p.x(), y, p.z());
      if (plant(type)) slice.region().setBlockData(p.x(), y, p.z(), blocks.get("minecraft:air"));
    }
  }

  private static boolean plant(Material type) {
    return Tag.LOGS.isTagged(type)
        || Tag.LEAVES.isTagged(type)
        || Tag.FLOWERS.isTagged(type)
        || Set.of(
                Material.SHORT_GRASS,
                Material.TALL_GRASS,
                Material.FERN,
                Material.LARGE_FERN,
                Material.SNOW,
                Material.VINE,
                Material.BAMBOO,
                Material.BAMBOO_SAPLING,
                Material.MUSHROOM_STEM,
                Material.RED_MUSHROOM_BLOCK,
                Material.BROWN_MUSHROOM_BLOCK,
                Material.BROWN_MUSHROOM,
                Material.RED_MUSHROOM)
            .contains(type);
  }
}
