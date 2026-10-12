package com.shepherdjerred.thestorm.rwf.adapter.paper;

import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;

/**
 * The kit layout editor's rules: items move only within the editor, never into or out of the
 * player's own inventory, and the Bomb Fuse never moves; on closing, where the items ended up is
 * saved as the player's layout for the kit, or left unsaved, with a word, when an item is missing.
 * Main thread only.
 */
final class KitLayoutListener implements Listener {

  private final Keys keys;
  private final Armory armory;

  KitLayoutListener(Keys keys, Armory armory) {
    this.keys = keys;
    this.armory = armory;
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onClick(InventoryClickEvent event) {
    if (!(event.getView().getTopInventory().getHolder() instanceof KitLayoutMenu)) {
      return;
    }
    var raw = event.getRawSlot();
    var inside = raw >= 0 && raw < KitLayoutMenu.SIZE;
    if (!inside || !plain(event.getAction()) || raw == KitLayoutMenu.FUSE) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onDrag(InventoryDragEvent event) {
    if (event.getView().getTopInventory().getHolder() instanceof KitLayoutMenu
        && event.getRawSlots().stream()
            .anyMatch(raw -> raw >= KitLayoutMenu.SIZE || raw == KitLayoutMenu.FUSE)) {
      event.setCancelled(true);
    }
  }

  @EventHandler
  void onClose(InventoryCloseEvent event) {
    if (!(event.getInventory().getHolder() instanceof KitLayoutMenu menu)
        || !(event.getPlayer() instanceof Player player)) {
      return;
    }
    // Whatever the cursor still holds goes back into the editor before it is read.
    var cursor = player.getItemOnCursor();
    if (!cursor.isEmpty()) {
      var _ = menu.getInventory().addItem(cursor);
      player.setItemOnCursor(null);
    }
    var layout = menu.read(keys);
    if (layout.isEmpty()) {
      Texts.error(
          player, "Your " + menu.kit().name() + " layout was not saved: an item is missing.");
      return;
    }
    armory.saveLayout(player.getUniqueId(), menu.kit().id(), layout.orElseThrow());
    Texts.info(player, "Saved your " + menu.kit().name() + " layout.");
  }

  /** Whether {@code action} only moves items within one inventory, one click at a time. */
  static boolean plain(InventoryAction action) {
    return switch (action) {
      case PICKUP_ALL,
          PICKUP_HALF,
          PICKUP_ONE,
          PICKUP_SOME,
          PLACE_ALL,
          PLACE_ONE,
          PLACE_SOME,
          SWAP_WITH_CURSOR,
          NOTHING ->
          true;
      default -> false;
    };
  }
}
