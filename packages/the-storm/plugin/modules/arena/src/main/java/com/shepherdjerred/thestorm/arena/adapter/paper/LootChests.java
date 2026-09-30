package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.reward.LootTable;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;
import org.bukkit.World;
import org.bukkit.block.Container;
import org.bukkit.inventory.Inventory;

/**
 * An arena's hidden loot chests: filled with tagged loot when a game starts and emptied when it
 * ends (and at enable, in case a crash left loot behind).
 */
final class LootChests {

  private final World world;
  private final List<BlockPos> chests;
  private final LootTable table;
  private final ItemFactory items;

  LootChests(World world, List<BlockPos> chests, LootTable table, ItemFactory items) {
    this.world = world;
    this.chests = List.copyOf(chests);
    this.table = table;
    this.items = items;
  }

  /** Every loot chest position that is not a container block. */
  List<String> problems() {
    var problems = new ArrayList<String>();
    for (var chest : chests) {
      if (!(Places.block(world, chest).getState() instanceof Container)) {
        problems.add("loot chest " + chest.describe() + " is not a container");
      }
    }
    return problems;
  }

  void fill(RandomGenerator random) {
    for (var chest : chests) {
      var inventory = inventory(chest);
      inventory.clear();
      for (var spec : table.roll(random)) {
        var slot = random.nextInt(inventory.getSize());
        if (inventory.getItem(slot) == null) {
          inventory.setItem(slot, items.arenaItem(spec));
        } else {
          inventory.addItem(items.arenaItem(spec));
        }
      }
    }
  }

  void empty() {
    chests.forEach(chest -> inventory(chest).clear());
  }

  boolean isChest(BlockPos block) {
    return chests.contains(block);
  }

  private Inventory inventory(BlockPos chest) {
    if (Places.block(world, chest).getState() instanceof Container container) {
      return container.getInventory();
    }
    throw new IllegalStateException("loot chest " + chest.describe() + " is no longer a container");
  }
}
