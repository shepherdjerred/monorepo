package com.shepherdjerred.thestorm.shards.adapter.paper;

import org.bukkit.block.Crafter;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.CrafterCraftEvent;
import org.bukkit.event.inventory.PrepareItemCraftEvent;
import org.bukkit.inventory.Inventory;

/**
 * Keeps shards out of vanilla recipes. A shard is a prismarine shard underneath, and nobody should
 * lose one to a stack of prismarine bricks or a sea lantern by accident.
 */
final class CraftingGuard implements Listener {

  private final ShardItems shards;

  CraftingGuard(ShardItems shards) {
    this.shards = shards;
  }

  @EventHandler
  void onPrepare(PrepareItemCraftEvent event) {
    if (containsShard(event.getInventory())) {
      event.getInventory().setResult(null);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onCrafter(CrafterCraftEvent event) {
    if (event.getBlock().getState() instanceof Crafter crafter
        && containsShard(crafter.getInventory())) {
      event.setCancelled(true);
    }
  }

  private boolean containsShard(Inventory inventory) {
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var item = inventory.getItem(slot);
      if (item != null && shards.isShard(item)) {
        return true;
      }
    }
    return false;
  }
}
