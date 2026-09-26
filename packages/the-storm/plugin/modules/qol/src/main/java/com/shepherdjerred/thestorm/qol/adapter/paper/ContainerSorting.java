package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.block.Barrel;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.block.Lockable;
import org.bukkit.block.ShulkerBox;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;

/**
 * Sorting the chest, barrel, shulker box or ender chest a player points at. A player may only sort
 * what they may open: land protection must allow opening containers there, and a container locked
 * with a key is never touched. Main thread only.
 */
final class ContainerSorting {

  /** How far away a looked-at container may be, as far as a player can reach. */
  private static final int REACH = 5;

  private final Protection protection;

  ContainerSorting(Protection protection) {
    this.protection = protection;
  }

  /** {@code /sort}: sorts the container {@code player} is looking at. */
  void sortLookedAt(Player player) {
    var block = player.getTargetBlockExact(REACH);
    if (block == null || inventory(player, block).isEmpty()) {
      Say.error(
          player,
          Say.SORT,
          "Look at a chest, barrel, shulker box or ender chest within reach, then /sort.");
      return;
    }
    sort(player, block);
  }

  /** Whether {@code block} is something that can be sorted. */
  static boolean isSortable(Block block) {
    if (block.getType() == Material.ENDER_CHEST) {
      return true;
    }
    var state = block.getState(false);
    return state instanceof Chest || state instanceof Barrel || state instanceof ShulkerBox;
  }

  /** Sorts {@code block} for {@code player} if they may open it. */
  void sort(Player player, Block block) {
    var inventory = inventory(player, block);
    if (inventory.isEmpty()) {
      return;
    }
    if (protection.check(player.getUniqueId(), ProtectedAction.OPEN_CONTAINER, block.getLocation())
        instanceof Decision.Denied(var reason)) {
      player.sendMessage(HouseStyle.error(Say.SORT, reason));
      return;
    }
    if (block.getState(false) instanceof Lockable lockable && lockable.isLocked()) {
      Say.error(player, Say.SORT, "That container is locked.");
      return;
    }
    InventorySorter.sort(inventory.orElseThrow());
    Say.success(player, Say.SORT, "Sorted.");
  }

  /** The inventory {@code player} would open at {@code block}; a double chest is sorted whole. */
  private static Optional<Inventory> inventory(Player player, Block block) {
    if (block.getType() == Material.ENDER_CHEST) {
      return Optional.of(player.getEnderChest());
    }
    var state = block.getState(false);
    if (state instanceof Chest chest) {
      return Optional.of(chest.getInventory());
    }
    if (state instanceof Barrel barrel) {
      return Optional.of(barrel.getInventory());
    }
    if (state instanceof ShulkerBox box) {
      return Optional.of(box.getInventory());
    }
    return Optional.empty();
  }
}
