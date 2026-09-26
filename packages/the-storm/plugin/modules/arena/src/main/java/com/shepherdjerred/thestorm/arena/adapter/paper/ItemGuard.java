package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.block.BlockState;
import org.bukkit.entity.Entity;
import org.bukkit.entity.HumanEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Wolf;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.EntityPlaceEvent;
import org.bukkit.event.hanging.HangingPlaceEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerArmorStandManipulateEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/**
 * Keeps arena items in the arena and outside items out of it.
 *
 * <p>A member (joining, in the lobby, fighting or watching) opens only their own inventory and, as
 * a fighter, their arena's loot chests; drops nothing; puts nothing into entities, frames, stands
 * or the world; and picks up only arena items. Anyone else who somehow holds an arena item loses it
 * the moment they open, click, close or pick it up, and so does any container they open.
 */
final class ItemGuard implements Listener {

  private final Arenas arenas;
  private final Keys keys;

  ItemGuard(Arenas arenas, Keys keys) {
    this.arenas = arenas;
    this.keys = keys;
  }

  /** Removes every arena item from {@code inventory}. */
  void sweep(Inventory inventory) {
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var item = inventory.getItem(slot);
      if (item != null && keys.isArenaItem(item)) {
        inventory.setItem(slot, null);
      }
    }
  }

  private boolean member(UUID player) {
    return arenas.of(player).isPresent();
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onDrop(PlayerDropItemEvent event) {
    if (member(event.getPlayer().getUniqueId())) {
      event.setCancelled(true);
    }
  }

  /**
   * Members pick up only arena items (and nothing while joining); anyone else touching an arena
   * item destroys it.
   */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onPickup(EntityPickupItemEvent event) {
    if (!(event.getEntity() instanceof Player player)) {
      return;
    }
    var arenaItem = keys.isArenaItem(event.getItem().getItemStack());
    var id = player.getUniqueId();
    if (arenas.joining(id)) {
      event.setCancelled(true);
    } else if (member(id)) {
      event.setCancelled(!arenaItem);
    } else if (arenaItem) {
      event.setCancelled(true);
      event.getItem().remove();
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onOpen(InventoryOpenEvent event) {
    var id = event.getPlayer().getUniqueId();
    var runner = arenas.of(id);
    if (runner.isPresent()) {
      if (!mayOpen(runner.orElseThrow(), id, event.getInventory())) {
        event.setCancelled(true);
      }
      return;
    }
    var running = at(event.getInventory()).flatMap(arenas::runningAt);
    if (running.isPresent()) {
      event.setCancelled(true);
      return;
    }
    sweep(event.getPlayer().getInventory());
    sweepUnlessMemberHeld(event.getInventory());
  }

  /**
   * Sweeps an inventory an outsider has open, unless it belongs to an arena member (a staff member
   * viewing a fighter's inventory must not delete their live kit).
   */
  private void sweepUnlessMemberHeld(Inventory inventory) {
    if (inventory.getHolder() instanceof HumanEntity holder && member(holder.getUniqueId())) {
      return;
    }
    sweep(inventory);
  }

  /** A member's own inventory, or (for a fighter) one of their arena's loot chests. */
  private boolean mayOpen(GameRunner runner, UUID player, Inventory inventory) {
    var type = inventory.getType();
    if (type == InventoryType.PLAYER || type == InventoryType.CRAFTING) {
      return true;
    }
    return runner.isFighter(player)
        && at(inventory)
            .filter(location -> runner.world().contains(location))
            .map(
                location ->
                    runner
                        .world()
                        .definition()
                        .lootChests()
                        .contains(Places.pos(location.getBlock())))
            .orElse(false);
  }

  /** Where a block's inventory is: its holder block's location, if a block holds it. */
  private static Optional<Location> at(Inventory inventory) {
    return inventory.getHolder() instanceof BlockState block
        ? Optional.of(block.getLocation())
        : Optional.empty();
  }

  /** Players still joining are frozen; outsiders clicking an arena item lose it. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onClick(InventoryClickEvent event) {
    var id = event.getWhoClicked().getUniqueId();
    if (arenas.joining(id)) {
      event.setCancelled(true);
      return;
    }
    if (member(id)
        || (event.getClickedInventory() != null
            && event.getClickedInventory().getHolder() instanceof HumanEntity holder
            && member(holder.getUniqueId()))) {
      return;
    }
    var current = event.getCurrentItem();
    if (current != null && keys.isArenaItem(current)) {
      event.setCancelled(true);
      event.setCurrentItem(null);
    }
    if (keys.isArenaItem(event.getCursor())) {
      event.setCancelled(true);
      event.getView().setCursor(ItemStack.empty());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onClose(InventoryCloseEvent event) {
    if (member(event.getPlayer().getUniqueId())) {
      return;
    }
    sweep(event.getPlayer().getInventory());
    sweepUnlessMemberHeld(event.getInventory());
  }

  /**
   * Members leave entities alone: no villagers, item frames, minecart chests or donkeys to hide
   * items in. Their own arena's wolves still answer to them.
   */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onInteractEntity(PlayerInteractEntityEvent event) {
    var id = event.getPlayer().getUniqueId();
    var runner = arenas.of(id);
    if (runner.isPresent() && !ownWolf(runner.orElseThrow(), id, event.getRightClicked())) {
      event.setCancelled(true);
    }
  }

  private boolean ownWolf(GameRunner runner, UUID player, Entity entity) {
    return !arenas.joining(player) && entity instanceof Wolf && runner.world().owns(entity);
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
