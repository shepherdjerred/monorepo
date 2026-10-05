package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.UUID;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.EntityPlaceEvent;
import org.bukkit.event.hanging.HangingPlaceEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerArmorStandManipulateEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerSwapHandItemsEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/**
 * Keeps kit items in the match and the Bomb Fuse in slot 0. A member opens only their own inventory
 * and the kit menu, drops nothing, places nothing, picks up only kit items, and cannot move, swap
 * or drop the fuse. Anyone outside who somehow holds a kit item loses it the moment they open,
 * click, close or pick it up.
 */
final class ItemGuard implements Listener {

  private final MatchRunner runner;
  private final Keys keys;

  ItemGuard(MatchRunner runner, Keys keys) {
    this.runner = runner;
    this.keys = keys;
  }

  /** Removes every kit item from {@code inventory}. */
  void sweep(Inventory inventory) {
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var item = inventory.getItem(slot);
      if (item != null && keys.isKitItem(item)) {
        inventory.setItem(slot, null);
      }
    }
  }

  private boolean member(UUID player) {
    return runner.memberOf(player).isPresent();
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onDrop(PlayerDropItemEvent event) {
    if (member(event.getPlayer().getUniqueId())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onPickup(EntityPickupItemEvent event) {
    if (!(event.getEntity() instanceof Player player)) {
      return;
    }
    var kitItem = keys.isKitItem(event.getItem().getItemStack());
    if (member(player.getUniqueId())) {
      event.setCancelled(!kitItem);
    } else if (kitItem) {
      event.setCancelled(true);
      event.getItem().remove();
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onOpen(InventoryOpenEvent event) {
    var player = event.getPlayer();
    if (member(player.getUniqueId())) {
      var type = event.getInventory().getType();
      if (type != InventoryType.PLAYER
          && type != InventoryType.CRAFTING
          && !(event.getInventory().getHolder() instanceof KitMenu)) {
        event.setCancelled(true);
      }
      return;
    }
    sweep(player.getInventory());
    sweep(event.getInventory());
  }

  /** Members never move the fuse; outsiders clicking a kit item lose it. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onClick(InventoryClickEvent event) {
    var who = event.getWhoClicked();
    if (member(who.getUniqueId())) {
      if (touchesFuse(event)) {
        event.setCancelled(true);
      }
      return;
    }
    var current = event.getCurrentItem();
    if (current != null && keys.isKitItem(current)) {
      event.setCancelled(true);
      event.setCurrentItem(null);
    }
    if (keys.isKitItem(event.getCursor())) {
      event.setCancelled(true);
      event.getView().setCursor(ItemStack.empty());
    }
  }

  private boolean touchesFuse(InventoryClickEvent event) {
    var current = event.getCurrentItem();
    if (current != null && keys.isFuse(current)) {
      return true;
    }
    if (keys.isFuse(event.getCursor())) {
      return true;
    }
    if (event.getHotbarButton() == KitFactory.FUSE_SLOT) {
      return true;
    }
    var bottom = event.getView().getBottomInventory();
    return event.getClickedInventory() != null
        && event.getClickedInventory().equals(bottom)
        && event.getSlot() == KitFactory.FUSE_SLOT;
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onDrag(InventoryDragEvent event) {
    if (!member(event.getWhoClicked().getUniqueId())) {
      return;
    }
    if (keys.isFuse(event.getOldCursor())) {
      event.setCancelled(true);
      return;
    }
    var view = event.getView();
    for (var raw : event.getRawSlots()) {
      var inventory = view.getInventory(raw);
      if (inventory != null
          && inventory.equals(view.getBottomInventory())
          && view.convertSlot(raw) == KitFactory.FUSE_SLOT) {
        event.setCancelled(true);
        return;
      }
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onSwapHands(PlayerSwapHandItemsEvent event) {
    if (!member(event.getPlayer().getUniqueId())) {
      return;
    }
    var main = event.getMainHandItem();
    var off = event.getOffHandItem();
    if ((main != null && keys.isFuse(main)) || (off != null && keys.isFuse(off))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onClose(InventoryCloseEvent event) {
    if (member(event.getPlayer().getUniqueId())) {
      return;
    }
    sweep(event.getPlayer().getInventory());
    sweep(event.getInventory());
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onArmorStand(PlayerArmorStandManipulateEvent event) {
    if (member(event.getPlayer().getUniqueId())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onHang(HangingPlaceEvent event) {
    var player = event.getPlayer();
    if (player != null && member(player.getUniqueId())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onPlaceEntity(EntityPlaceEvent event) {
    var player = event.getPlayer();
    if (player != null && member(player.getUniqueId())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onEmptyBucket(PlayerBucketEmptyEvent event) {
    if (member(event.getPlayer().getUniqueId())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onFillBucket(PlayerBucketFillEvent event) {
    if (member(event.getPlayer().getUniqueId())) {
      event.setCancelled(true);
    }
  }
}
