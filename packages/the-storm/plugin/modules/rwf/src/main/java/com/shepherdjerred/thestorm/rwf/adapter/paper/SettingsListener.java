package com.shepherdjerred.thestorm.rwf.adapter.paper;

import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;

/** Settings inventories never transfer items, including shift-clicks in the player's inventory. */
final class SettingsListener implements Listener {
  private final MatchRunner runner;
  private final PaperContext context;

  SettingsListener(MatchRunner runner, PaperContext context) {
    this.runner = runner;
    this.context = context;
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onClick(InventoryClickEvent event) {
    if (event.getView().getTopInventory().getHolder() instanceof CandidateMenu menu) {
      event.setCancelled(true);
      if (event.getWhoClicked() instanceof Player player
          && event.getRawSlot() >= 0
          && event.getRawSlot() < CandidateMenu.SIZE) {
        var slot = event.getRawSlot();
        context.scheduler().runOnMainThread(() -> runner.candidateAction(player, menu, slot));
      }
      return;
    }
    if (!(event.getView().getTopInventory().getHolder() instanceof SettingsMenu)) {
      return;
    }
    event.setCancelled(true);
    if (event.getWhoClicked() instanceof Player player
        && event.getRawSlot() >= 0
        && event.getRawSlot() < SettingsMenu.SIZE) {
      var slot = event.getRawSlot();
      var step = event.isShiftClick() ? 5 : 1;
      context.scheduler().runOnMainThread(() -> runner.changeSettings(player, slot, step));
    }
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onDrag(InventoryDragEvent event) {
    if (event.getView().getTopInventory().getHolder() instanceof SettingsMenu
        || event.getView().getTopInventory().getHolder() instanceof CandidateMenu) {
      event.setCancelled(true);
    }
  }
}
