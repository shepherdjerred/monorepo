package com.shepherdjerred.thestorm.qol.adapter.paper;

import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

/**
 * Punching a container while sneaking with an empty hand sorts it: easy to find, and nothing else
 * uses that gesture on a container. The punch itself is cancelled so it never starts breaking the
 * block.
 */
final class SortListener implements Listener {

  private final ContainerSorting sorting;

  SortListener(ContainerSorting sorting) {
    this.sorting = sorting;
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onPunch(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    var player = event.getPlayer();
    if (block == null
        || event.getAction() != Action.LEFT_CLICK_BLOCK
        || event.getHand() != EquipmentSlot.HAND
        || !player.isSneaking()
        || !player.getInventory().getItemInMainHand().isEmpty()
        || !player.hasPermission(QolPermissions.SORT)
        || !ContainerSorting.isSortable(block)) {
      return;
    }
    event.setCancelled(true);
    sorting.sort(player, block);
  }
}
