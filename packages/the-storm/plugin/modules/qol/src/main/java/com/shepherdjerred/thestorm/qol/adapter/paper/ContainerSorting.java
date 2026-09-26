package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Barrel;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.block.Lockable;
import org.bukkit.block.ShulkerBox;
import org.bukkit.entity.Player;
import org.bukkit.inventory.DoubleChestInventory;
import org.bukkit.inventory.Inventory;

/**
 * Sorting the chest, barrel, shulker box or ender chest a player points at. A player may only sort
 * what they may open: land protection (which also enforces locks) must allow opening containers at
 * every block the inventory spans, both halves of a double chest included, and a container locked
 * with a vanilla key is never touched. Main thread only.
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
    var found = inventory(player, block);
    if (found.isEmpty()) {
      return;
    }
    var inventory = found.orElseThrow();
    var refusal = refusal(player, block, inventory);
    if (refusal.isPresent()) {
      player.sendMessage(HouseStyle.error(Say.SORT, refusal.orElseThrow()));
      return;
    }
    InventorySorter.sort(inventory);
    Say.success(player, Say.SORT, "Sorted.");
  }

  /** Why {@code player} may not sort {@code inventory} at {@code block}, or empty if they may. */
  Optional<Component> refusal(Player player, Block block, Inventory inventory) {
    for (var at : spans(block, inventory)) {
      if (at.getBlock().getState(false) instanceof Lockable lockable && lockable.isLocked()) {
        return Optional.of(Component.text("That container is locked."));
      }
      if (protection.check(player.getUniqueId(), ProtectedAction.OPEN_CONTAINER, at)
          instanceof Decision.Denied(var reason)) {
        return Optional.of(reason);
      }
    }
    return Optional.empty();
  }

  /** Every block {@code inventory} lives in: both halves of a double chest, else the block. */
  static List<Location> spans(Block block, Inventory inventory) {
    var spans = new ArrayList<Location>();
    spans.add(block.getLocation());
    if (inventory instanceof DoubleChestInventory chest) {
      for (var half : List.of(chest.getLeftSide(), chest.getRightSide())) {
        var at = half.getLocation();
        if (at == null) {
          throw new IllegalStateException("a double chest half has no location at " + block);
        }
        spans.add(at);
      }
    }
    return spans;
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
