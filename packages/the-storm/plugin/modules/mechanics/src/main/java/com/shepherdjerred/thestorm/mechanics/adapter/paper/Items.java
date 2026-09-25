package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/** Handing out items without losing any to full inventories or stack limits. */
final class Items {

  private Items() {}

  /** Gives {@code count} of {@code kind}, dropping what does not fit at the player's feet. */
  static void give(Player player, ItemStack kind, int count) {
    for (var remaining = count; remaining > 0; ) {
      var stack = kind.asQuantity(Math.min(remaining, kind.getMaxStackSize()));
      remaining -= stack.getAmount();
      player
          .getInventory()
          .addItem(stack)
          .values()
          .forEach(leftover -> player.getWorld().dropItemNaturally(PaperGrid.at(player), leftover));
    }
  }

  /** Drops {@code count} of {@code kind} at {@code location}, in full stacks. */
  static void drop(Location location, ItemStack kind, int count) {
    for (var remaining = count; remaining > 0; ) {
      var stack = kind.asQuantity(Math.min(remaining, kind.getMaxStackSize()));
      remaining -= stack.getAmount();
      location.getWorld().dropItemNaturally(location, stack);
    }
  }
}
