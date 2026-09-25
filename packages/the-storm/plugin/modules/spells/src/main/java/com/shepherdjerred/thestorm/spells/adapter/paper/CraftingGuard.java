package com.shepherdjerred.thestorm.spells.adapter.paper;

import org.bukkit.block.Crafter;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.CrafterCraftEvent;
import org.bukkit.event.inventory.PrepareItemCraftEvent;
import org.bukkit.inventory.Inventory;

/** Keeps spell items (paper underneath) out of vanilla recipes such as books and maps. */
final class CraftingGuard implements Listener {

  private final SpellItems items;

  CraftingGuard(SpellItems items) {
    this.items = items;
  }

  @EventHandler
  void onPrepare(PrepareItemCraftEvent event) {
    if (containsSpellItem(event.getInventory())) {
      event.getInventory().setResult(null);
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onCrafter(CrafterCraftEvent event) {
    if (event.getBlock().getState() instanceof Crafter crafter
        && containsSpellItem(crafter.getInventory())) {
      event.setCancelled(true);
    }
  }

  private boolean containsSpellItem(Inventory inventory) {
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var item = inventory.getItem(slot);
      if (item != null && items.identify(item).isPresent()) {
        return true;
      }
    }
    return false;
  }
}
