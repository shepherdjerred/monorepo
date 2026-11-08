package com.shepherdjerred.thestorm.shops.adapter.paper;

import java.util.Objects;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Container;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/** Disposable real-Paper verification of live inventories, snapshots and stock markers. */
public final class HistoricalStockE2EPlugin extends JavaPlugin {
  @Override
  public void onEnable() {
    var world = Objects.requireNonNull(getServer().getWorld("world"), "fixture world");
    var block = world.getBlockAt(700, -50, 700);
    var finishedKey = new NamespacedKey(this, "fixture_finished");
    if (block.getState() instanceof Container previous
        && previous.getPersistentDataContainer().has(finishedKey, PersistentDataType.BYTE)) {
      var inventory = previous.getInventory();
      require(count(inventory, Material.DIAMOND) == 2, "saved diamond stock");
      require(count(inventory, Material.GOLD_INGOT) == 12, "saved original goods");
      require(count(inventory, Material.ARROW) == 128, "saved bulk stock");
      require(
          new HistoricalStock(this).stock(block, "diamond-shop", ItemStack.of(Material.DIAMOND), 32)
              == HistoricalStock.Result.ALREADY_STOCKED,
          "saved stock marker");
      getComponentLogger().info("HISTORICAL_STOCK_PAPER_RESTART_PASS");
      return;
    }
    block.setType(Material.AIR, false);
    block.setType(Material.CHEST, false);
    var live = ((Container) block.getState()).getInventory();
    live.clear();
    live.setItem(0, ItemStack.of(Material.DIAMOND, 7));
    live.setItem(1, ItemStack.of(Material.GOLD_INGOT, 12));
    var stock = new HistoricalStock(this);
    require(
        stock.stock(block, "diamond-shop", ItemStack.of(Material.DIAMOND), 32)
            == HistoricalStock.Result.STOCKED,
        "initial stock");
    var after = ((Container) block.getState()).getInventory();
    require(count(after, Material.DIAMOND) == 32, "diamond shortfall");
    require(count(after, Material.GOLD_INGOT) == 12, "existing goods");
    after.setItem(0, ItemStack.of(Material.DIAMOND, 2));
    require(
        stock.stock(block, "diamond-shop", ItemStack.of(Material.DIAMOND), 32)
            == HistoricalStock.Result.ALREADY_STOCKED,
        "no repeat grant");
    require(
        count(((Container) block.getState()).getInventory(), Material.DIAMOND) == 2,
        "sale is not undone");
    require(
        stock.stock(block, "arrows", ItemStack.of(Material.ARROW), 128)
            == HistoricalStock.Result.STOCKED,
        "shared chest");
    require(
        count(((Container) block.getState()).getInventory(), Material.ARROW) == 128, "bulk stock");
    var fullBlock = world.getBlockAt(702, -50, 700);
    fullBlock.setType(Material.CHEST, false);
    var full = ((Container) fullBlock.getState()).getInventory();
    for (var i = 0; i < full.getSize(); i++)
      full.setItem(i, ItemStack.of(Material.COBBLESTONE, 64));
    require(
        stock.stock(fullBlock, "full", ItemStack.of(Material.DIAMOND), 16)
            == HistoricalStock.Result.NO_SPACE,
        "full chest refusal");
    require(
        count(((Container) fullBlock.getState()).getInventory(), Material.DIAMOND) == 0,
        "full chest unchanged");
    var finished = (Container) block.getState();
    finished.getPersistentDataContainer().set(finishedKey, PersistentDataType.BYTE, (byte) 1);
    require(finished.update(false, false), "fixture marker");
    getComponentLogger().info("HISTORICAL_STOCK_PAPER_PASS");
  }

  private static int count(Inventory inventory, Material item) {
    var total = 0;
    for (var stack : Objects.requireNonNull(inventory.getContents())) {
      if (stack != null && stack.getType() == item) total += stack.getAmount();
    }
    return total;
  }

  private static void require(boolean ok, String check) {
    if (!ok) throw new IllegalStateException("Historical stock fixture failed: " + check);
  }
}
