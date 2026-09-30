package com.shepherdjerred.thestorm.towns.adapter.paper;

import java.util.UUID;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.TileState;
import org.bukkit.persistence.PersistentDataType;
import org.jspecify.annotations.Nullable;

/**
 * Who placed a lockable container, kept on the container itself, so only they may lock it and
 * nobody can lock someone else's unlocked chest out from under them. Containers placed before locks
 * existed, and generated ones, have no placer.
 */
final class Placers {

  private final NamespacedKey key;

  Placers(NamespacedKey key) {
    this.key = key;
  }

  boolean record(Block block, UUID player) {
    if (block.getState(false) instanceof TileState tile) {
      tile.getPersistentDataContainer().set(key, PersistentDataType.STRING, player.toString());
      return tile.update();
    }
    return false;
  }

  @Nullable UUID placedBy(Block block) {
    if (!(block.getState(false) instanceof TileState tile)) {
      return null;
    }
    var stored = tile.getPersistentDataContainer().get(key, PersistentDataType.STRING);
    return stored == null ? null : UUID.fromString(stored);
  }
}
