package com.shepherdjerred.thestorm.rwf.adapter.paper;

import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.InventoryView;

/**
 * The kit menu is read-only: every click and drag while it is open is cancelled, in the chest and
 * in the player's own inventory below it, before any other listener sees it. A member's click on a
 * kit's icon picks that kit through the same path as {@code /rwf kit}; the menu closes on the next
 * tick, once the click is over.
 */
final class KitMenuListener implements Listener {

  private final MatchRunner runner;
  private final PaperContext context;

  KitMenuListener(MatchRunner runner, PaperContext context) {
    this.runner = runner;
    this.context = context;
  }

  private static boolean menu(InventoryView view) {
    return view.getTopInventory().getHolder() instanceof KitMenu;
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onClick(InventoryClickEvent event) {
    var view = event.getView();
    if (!(view.getTopInventory().getHolder() instanceof KitMenu menu)) {
      return;
    }
    event.setCancelled(true);
    if (!(event.getWhoClicked() instanceof Player player)
        || event.getRawSlot() < 0
        || event.getRawSlot() >= KitMenu.SIZE) {
      return;
    }
    menu.kitAt(event.getRawSlot())
        .ifPresent(
            kit ->
                runner
                    .pickKit(player, kit)
                    .ifPresentOrElse(
                        refusal -> Texts.error(player, refusal),
                        () -> context.scheduler().runOnMainThread(() -> KitMenu.close(player))));
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onDrag(InventoryDragEvent event) {
    if (menu(event.getView())) {
      event.setCancelled(true);
    }
  }
}
