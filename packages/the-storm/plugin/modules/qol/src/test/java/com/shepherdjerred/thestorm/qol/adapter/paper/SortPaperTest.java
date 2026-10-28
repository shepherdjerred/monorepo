package com.shepherdjerred.thestorm.qol.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import org.bukkit.Material;
import org.bukkit.block.Container;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class SortPaperTest {

  @TempDir Path directory;
  QolHarness harness;

  @BeforeEach
  void start() {
    harness = QolHarness.start(directory);
  }

  @AfterEach
  void stop() {
    harness.close();
  }

  @Test
  void sortInventoryPutsFoodBeforeStoneAndLeavesTheHotbar() {
    var alice = harness.playerAt("Alice", 0, 0);
    alice.getInventory().setItem(0, new ItemStack(Material.DIRT));
    alice.getInventory().setItem(9, new ItemStack(Material.STONE));
    alice.getInventory().setItem(10, new ItemStack(Material.APPLE));

    assertThat(alice.performCommand("sort inventory")).isTrue();

    assertThat(requireNonNull(alice.getInventory().getItem(0)).getType()).isEqualTo(Material.DIRT);
    assertThat(requireNonNull(alice.getInventory().getItem(9)).getType()).isEqualTo(Material.APPLE);
    assertThat(requireNonNull(alice.getInventory().getItem(10)).getType())
        .isEqualTo(Material.STONE);
  }

  @Test
  void chestsStayUnsortedUntilAutomaticSortingIsOn() {
    var alice = harness.playerAt("Alice", 0, 0);
    var chest = chest();
    var inventory = ((Container) chest.getState()).getInventory();
    inventory.setItem(0, new ItemStack(Material.STONE));
    inventory.setItem(1, new ItemStack(Material.APPLE));

    alice.openInventory(inventory);
    alice.closeInventory();
    assertThat(requireNonNull(inventory.getItem(0)).getType()).isEqualTo(Material.STONE);

    assertThat(alice.performCommand("sort on")).isTrue();
    alice.openInventory(inventory);
    alice.closeInventory();

    assertThat(requireNonNull(inventory.getItem(0)).getType()).isEqualTo(Material.APPLE);
    assertThat(requireNonNull(inventory.getItem(1)).getType()).isEqualTo(Material.STONE);
  }

  @Test
  void aPluginScreenIsNotSorted() {
    var alice = harness.playerAt("Alice", 0, 0);
    assertThat(alice.performCommand("sort on")).isTrue();
    var menu = new Menu();
    var inventory =
        harness.server.createInventory(
            menu, 9, net.kyori.adventure.text.Component.text("backpack"));
    menu.attach(inventory);
    inventory.setItem(0, new ItemStack(Material.STONE));
    inventory.setItem(1, new ItemStack(Material.APPLE));

    alice.openInventory(inventory);
    alice.closeInventory();

    assertThat(requireNonNull(inventory.getItem(0)).getType()).isEqualTo(Material.STONE);
    assertThat(requireNonNull(inventory.getItem(1)).getType()).isEqualTo(Material.APPLE);
  }

  private org.bukkit.block.Block chest() {
    harness.world.loadChunk(0, 0);
    var block = harness.world.getBlockAt(0, 64, 0);
    block.setType(Material.CHEST);
    return block;
  }

  private static final class Menu implements InventoryHolder {
    private @Nullable Inventory inventory;

    void attach(Inventory inventory) {
      this.inventory = inventory;
    }

    @Override
    public Inventory getInventory() {
      return requireNonNull(inventory, "menu");
    }
  }
}
