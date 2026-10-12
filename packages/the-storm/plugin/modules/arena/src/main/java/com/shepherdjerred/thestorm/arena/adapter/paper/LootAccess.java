package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.util.List;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.block.Container;
import org.bukkit.block.DoubleChest;
import org.bukkit.inventory.Inventory;

/** Block clicks and inventory opening share the same physical loot-container identity. */
final class LootAccess {
  private LootAccess() {}

  static List<Location> locations(Inventory inventory) {
    var holder = inventory.getHolder();
    if (holder instanceof DoubleChest chest
        && chest.getLeftSide() instanceof BlockState left
        && chest.getRightSide() instanceof BlockState right) {
      return List.of(left.getLocation(), right.getLocation());
    }
    return holder instanceof BlockState block ? List.of(block.getLocation()) : List.of();
  }

  static boolean allowed(ArenaRunner runner, UUID player, Inventory inventory) {
    var locations = locations(inventory);
    return runner.isFighter(player)
        && !locations.isEmpty()
        && locations.stream().allMatch(runner.world()::contains)
        && locations.stream()
            .map(l -> Places.pos(l.getBlock()))
            .anyMatch(runner.world().definition().lootChests()::contains);
  }

  static boolean allowed(ArenaRunner runner, UUID player, Block block) {
    return block.getState() instanceof Container container
        && allowed(runner, player, container.getInventory());
  }
}
