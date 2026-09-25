package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.shards.domain.PlacedPositions;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.persistence.PersistentDataType;

/**
 * Remembers which shard-source blocks (ores) a player placed, in the chunk's persistent data, so
 * silk-touched ore cannot be placed and mined again for another roll. The chunk saves the set with
 * the world; nothing touches the database.
 */
final class PlacedBlocks {

  private final NamespacedKey key;

  PlacedBlocks(NamespacedKey key) {
    this.key = key;
  }

  boolean isPlaced(Block block) {
    return PlacedPositions.contains(positions(block), packed(block));
  }

  void markPlaced(Block block) {
    store(block, PlacedPositions.with(positions(block), packed(block)));
  }

  void clear(Block block) {
    var positions = positions(block);
    var packed = packed(block);
    if (PlacedPositions.contains(positions, packed)) {
      store(block, PlacedPositions.without(positions, packed));
    }
  }

  private int[] positions(Block block) {
    var stored =
        block.getChunk().getPersistentDataContainer().get(key, PersistentDataType.INTEGER_ARRAY);
    return stored == null ? PlacedPositions.none() : stored;
  }

  private void store(Block block, int[] positions) {
    var container = block.getChunk().getPersistentDataContainer();
    if (positions.length == 0) {
      container.remove(key);
    } else {
      container.set(key, PersistentDataType.INTEGER_ARRAY, positions);
    }
  }

  private static int packed(Block block) {
    return PlacedPositions.pack(block.getX(), block.getY(), block.getZ());
  }
}
