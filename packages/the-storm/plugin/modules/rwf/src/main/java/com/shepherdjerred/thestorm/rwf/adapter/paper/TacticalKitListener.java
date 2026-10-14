package com.shepherdjerred.thestorm.rwf.adapter.paper;

import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

/** Tactical items deny native bundle, sensor and horn interactions before running kit rules. */
final class TacticalKitListener implements Listener {
  private final MatchRunner runner;
  private final Keys keys;

  TacticalKitListener(MatchRunner runner, Keys keys) {
    this.runner = runner;
    this.keys = keys;
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void use(PlayerInteractEvent event) {
    var player = event.getPlayer();
    var item = event.getItem();
    if (event.getHand() == EquipmentSlot.OFF_HAND
        || item == null
        || !event.getAction().isRightClick()
        || !runner.fighting(player.getUniqueId())
        || !keys.isKitItem(item)) return;
    runner
        .powers()
        .tactical()
        .input(player, item.getType())
        .ifPresent(
            input -> {
              event.setUseItemInHand(Event.Result.DENY);
              event.setUseInteractedBlock(Event.Result.DENY);
              runner.kits().act(player, input);
            });
  }
}
