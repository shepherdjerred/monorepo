package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwfbots.domain.tactics.CratePlay;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;

/** Puts a supply crate's diamond chestplate on, and a steak into an empty hotbar slot. */
final class CrateGear {

  private static final int HOTBAR = 9;

  private CrateGear() {}

  /** Whether the next dropped killstreak in {@code player}'s inventory is a supply crate. */
  static boolean nextIsCrate(Player player) {
    var inventory = player.getInventory();
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var stack = inventory.getItem(slot);
      if (stack == null || stack.isEmpty()) {
        continue;
      }
      var material = stack.getType().name();
      if (!com.shepherdjerred.thestorm.rwf.app.view.StreakItems.DROPPED.contains(material)) {
        continue;
      }
      return material.equals(
          com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak.SUPPLY_CRATE.item());
    }
    return false;
  }

  static void equip(Player player) {
    var inventory = player.getInventory();
    wear(inventory);
    steak(inventory);
  }

  private static void wear(PlayerInventory inventory) {
    var chest = inventory.getChestplate();
    var wearing = chest != null && chest.getType() == Material.DIAMOND_CHESTPLATE;
    var carried = java.util.Optional.<ItemStack>empty();
    var carriedSlot = -1;
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var stack = inventory.getItem(slot);
      if (stack != null && stack.getType() == Material.DIAMOND_CHESTPLATE) {
        carried = java.util.Optional.of(stack);
        carriedSlot = slot;
        break;
      }
    }
    if (carried.isEmpty() || !CratePlay.wearChestplate(wearing, true)) {
      return;
    }
    inventory.setItem(carriedSlot, chest);
    inventory.setChestplate(carried.orElseThrow());
  }

  private static void steak(PlayerInventory inventory) {
    for (var slot = 0; slot < HOTBAR; slot++) {
      var stack = inventory.getItem(slot);
      if (stack != null && beef(stack)) {
        return;
      }
    }
    for (var slot = HOTBAR; slot < inventory.getSize(); slot++) {
      var stack = inventory.getItem(slot);
      if (stack == null || !beef(stack)) {
        continue;
      }
      var empty = emptyHotbar(inventory);
      if (empty < 0) {
        return;
      }
      inventory.setItem(empty, stack);
      inventory.setItem(slot, null);
      return;
    }
  }

  private static int emptyHotbar(PlayerInventory inventory) {
    for (var slot = 0; slot < HOTBAR; slot++) {
      var stack = inventory.getItem(slot);
      if (stack == null || stack.getType().isAir()) {
        return slot;
      }
    }
    return -1;
  }

  private static boolean beef(ItemStack stack) {
    return stack != null && stack.getType() == Material.COOKED_BEEF && stack.getAmount() > 0;
  }
}
