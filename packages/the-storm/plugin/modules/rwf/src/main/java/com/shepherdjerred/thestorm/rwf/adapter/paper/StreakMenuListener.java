package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.UUID;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;

/** Reward selection inventories are read-only; only authenticated actions change preferences. */
final class StreakMenuListener implements Listener {
  private final MatchRunner runner;
  private final PaperContext context;

  StreakMenuListener(MatchRunner runner, PaperContext context) {
    this.runner = runner;
    this.context = context;
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onClick(InventoryClickEvent event) {
    if (!(event.getView().getTopInventory().getHolder() instanceof StreakMenu menu)) return;
    event.setCancelled(true);
    if (!(event.getWhoClicked() instanceof Player player)) return;
    if (!runner.match().phase().kitsOpen() || runner.memberOf(player.getUniqueId()).isEmpty())
      return;
    var slot = event.getRawSlot();
    if (slot == StreakMenu.SAVE) {
      menu.selection()
          .ifPresentOrElse(
              loadout -> runner.streakPicker().select(player, loadout),
              () ->
                  Texts.error(player, "Choose three rewards at different kill thresholds first."));
    } else if (slot == StreakMenu.BACK) {
      var matchId = runner.match().matchId();
      context.scheduler().runOnMainThread(() -> back(player, matchId));
    } else {
      menu.rewardAt(slot).ifPresent(menu::toggle);
    }
  }

  private void back(Player player, UUID matchId) {
    if (player.isOnline()
        && runner.match().matchId().equals(matchId)
        && runner.memberOf(player.getUniqueId()).isPresent()
        && runner.match().phase().kitsOpen()) {
      runner.picker().browse(player);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onDrag(InventoryDragEvent event) {
    if (event.getView().getTopInventory().getHolder() instanceof StreakMenu)
      event.setCancelled(true);
  }
}
