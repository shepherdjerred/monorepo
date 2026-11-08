package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog;
import java.util.LinkedHashMap;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.block.Container;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.Test;

final class HistoricalStockTest extends ShopsFixture {
  @Test
  void interruptedSplitIsNotAcceptedAsCompletedStock() {
    assertThat(HistoricalStock.completeMarkers(List.of((byte) 2))).isFalse();
    assertThat(HistoricalStock.completeMarkers(List.of((byte) 2, (byte) 2))).isTrue();
    assertThat(HistoricalStock.completeMarkers(List.of((byte) 1))).isTrue();
    assertThat(HistoricalStock.completeMarkers(List.of((byte) 1, (byte) 2))).isFalse();
    assertThat(HistoricalStock.completeMarkers(List.of())).isFalse();
  }

  @Test
  void stocksOnlyTheShortfallAndDoesNotRepeatOrReplaceOtherItems() {
    var block = chest(0);
    var initial = (Container) block.getState();
    var inventory = initial.getSnapshotInventory();
    inventory.setItem(0, ItemStack.of(Material.DIAMOND, 7));
    inventory.setItem(1, ItemStack.of(Material.GOLD_INGOT, 12));
    initial.update();
    var stock = new HistoricalStock(plugin);

    assertThat(stock.stock(block, "2015:test", ItemStack.of(Material.DIAMOND), 32))
        .isEqualTo(HistoricalStock.Result.STOCKED);
    assertThat(((Container) block.getState()).getInventory().all(Material.DIAMOND).values())
        .extracting(ItemStack::getAmount)
        .containsExactly(32);
    assertThat(((Container) block.getState()).getInventory().getItem(1))
        .isEqualTo(ItemStack.of(Material.GOLD_INGOT, 12));

    var sold = (Container) block.getState();
    sold.getSnapshotInventory().setItem(0, ItemStack.of(Material.DIAMOND, 2));
    sold.update();
    assertThat(stock.stock(block, "2015:test", ItemStack.of(Material.DIAMOND), 32))
        .isEqualTo(HistoricalStock.Result.ALREADY_STOCKED);
    assertThat(((Container) block.getState()).getInventory().all(Material.DIAMOND).values())
        .extracting(ItemStack::getAmount)
        .containsExactly(2);
  }

  @Test
  void fullContainerIsUnchangedAndCanBeRetried() {
    var block = chest(0);
    var initial = (Container) block.getState();
    var inventory = initial.getSnapshotInventory();
    for (var i = 0; i < inventory.getSize(); i++) {
      inventory.setItem(i, ItemStack.of(Material.COBBLESTONE, 64));
    }
    initial.update();
    var stock = new HistoricalStock(plugin);
    assertThat(stock.stock(block, "2015:full", ItemStack.of(Material.DIAMOND), 16))
        .isEqualTo(HistoricalStock.Result.NO_SPACE);
    assertThat(((Container) block.getState()).getInventory().contains(Material.DIAMOND)).isFalse();
    var cleared = (Container) block.getState();
    cleared.getSnapshotInventory().clear(0);
    cleared.update();
    assertThat(stock.stock(block, "2015:full", ItemStack.of(Material.DIAMOND), 16))
        .isEqualTo(HistoricalStock.Result.STOCKED);
  }

  @Test
  void aBundleNeedsSpaceForEveryPartAndIsNeverPartiallyGrantedOrRefilled() {
    var block = chest(0);
    var initial = (Container) block.getState();
    for (var i = 1; i < initial.getSnapshotInventory().getSize(); i++)
      initial.getSnapshotInventory().setItem(i, ItemStack.of(Material.COBBLESTONE, 64));
    initial.update();
    var stock = new HistoricalStock(plugin);
    var targets = List.of(ItemStack.of(Material.BOW), ItemStack.of(Material.ARROW, 32));
    assertThat(stock.stock(block, "bundle", targets)).isEqualTo(HistoricalStock.Result.NO_SPACE);
    assertThat(inventoryOf(block).contains(Material.BOW)).isFalse();
    assertThat(inventoryOf(block).contains(Material.ARROW)).isFalse();
    var cleared = (Container) block.getState();
    cleared.getSnapshotInventory().clear(1);
    cleared.update();
    assertThat(stock.stock(block, "bundle", targets)).isEqualTo(HistoricalStock.Result.STOCKED);
    assertThat(count(inventoryOf(block), Material.BOW)).isEqualTo(1);
    assertThat(count(inventoryOf(block), Material.ARROW)).isEqualTo(32);
    var sold = (Container) block.getState();
    sold.getSnapshotInventory().clear(0);
    sold.getSnapshotInventory().clear(1);
    sold.update();
    assertThat(stock.stock(block, "bundle", targets))
        .isEqualTo(HistoricalStock.Result.ALREADY_STOCKED);
    assertThat(inventoryOf(block).contains(Material.BOW)).isFalse();
    assertThat(inventoryOf(block).contains(Material.ARROW)).isFalse();
  }

  @Test
  void existingStockAboveTheTargetIsNeverRemoved() {
    var block = chest(0);
    var initial = (Container) block.getState();
    initial.getSnapshotInventory().setItem(0, ItemStack.of(Material.DIAMOND, 48));
    initial.update();
    assertThat(
            new HistoricalStock(plugin)
                .stock(block, "2015:excess", ItemStack.of(Material.DIAMOND), 16))
        .isEqualTo(HistoricalStock.Result.STOCKED);
    assertThat(((Container) block.getState()).getInventory().getItem(0))
        .isEqualTo(ItemStack.of(Material.DIAMOND, 48));
  }

  @Test
  void separateListingsCanShareAChestWithoutRefillingOneAnother() {
    var block = chest(0);
    var stock = new HistoricalStock(plugin);
    assertThat(stock.stock(block, "arrows", ItemStack.of(Material.ARROW), 128))
        .isEqualTo(HistoricalStock.Result.STOCKED);
    assertThat(stock.stock(block, "flesh", ItemStack.of(Material.ROTTEN_FLESH), 64))
        .isEqualTo(HistoricalStock.Result.STOCKED);
    var contents = ((Container) block.getState()).getInventory();
    assertThat(count(contents, Material.ARROW)).isEqualTo(128);
    assertThat(count(contents, Material.ROTTEN_FLESH)).isEqualTo(64);
    assertThat(stock.stock(block, "arrows", ItemStack.of(Material.ARROW), 128))
        .isEqualTo(HistoricalStock.Result.ALREADY_STOCKED);
    assertThat(stock.stock(block, "flesh", ItemStack.of(Material.ROTTEN_FLESH), 64))
        .isEqualTo(HistoricalStock.Result.ALREADY_STOCKED);
  }

  @Test
  void plannedDockozelStockFitsInItsSharedSingleChests() {
    var groups =
        new LinkedHashMap<HistoricalShopCatalog.Point, List<HistoricalShopCatalog.Entry>>();
    for (var entry : HistoricalShopCatalog.load()) {
      if (!entry.id().startsWith("2016-dockozel-")) continue;
      groups.computeIfAbsent(entry.container(), _ -> new java.util.ArrayList<>()).add(entry);
    }
    assertThat(groups).hasSize(6);
    var stock = new HistoricalStock(plugin);
    var index = 0;
    for (var entries : groups.values()) {
      var block = chest(index++ * 2);
      for (var entry : entries) {
        var item = ItemStack.of(ItemTemplates.item(entry.item()).orElseThrow());
        assertThat(stock.stock(block, entry.id(), item, entry.stockTarget()))
            .as(entry.id())
            .isEqualTo(HistoricalStock.Result.STOCKED);
      }
      var inventory = ((Container) block.getState()).getInventory();
      for (var entry : entries) {
        assertThat(count(inventory, ItemTemplates.item(entry.item()).orElseThrow()))
            .as(entry.id())
            .isEqualTo(entry.stockTarget());
      }
    }
  }
}
