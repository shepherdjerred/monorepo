package com.shepherdjerred.thestorm.qol.adapter.paper;

import org.bukkit.NamespacedKey;
import org.bukkit.inventory.ItemStack;

/**
 * The arena module's persistent-data tags, a contract between modules: the arena sets them, qol
 * reads them without depending on the arena. Arena gear and rewards never go into a grave.
 */
final class ArenaTags {

  /** On every item the arena hands out (any type). */
  static final NamespacedKey ITEM = new NamespacedKey("thestorm", "arena_item");

  private ArenaTags() {}

  static boolean isArenaItem(ItemStack stack) {
    var meta = stack.getItemMeta();
    return meta != null && meta.getPersistentDataContainer().has(ITEM);
  }
}
