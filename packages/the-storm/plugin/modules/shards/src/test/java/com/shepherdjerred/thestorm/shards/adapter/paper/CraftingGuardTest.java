package com.shepherdjerred.thestorm.shards.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Objects;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Crafter;
import org.bukkit.event.block.CrafterCraftEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.inventory.PrepareItemCraftEvent;
import org.bukkit.inventory.CraftingInventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.ShapelessRecipe;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

final class CraftingGuardTest {

  private final Harness harness = new Harness();
  private final CraftingGuard guard = new CraftingGuard(harness.shards);

  @AfterEach
  void tearDown() {
    harness.close();
  }

  private PrepareItemCraftEvent prepare(ItemStack ingredient) {
    var player = harness.server.addPlayer();
    var table = (CraftingInventory) harness.server.createInventory(player, InventoryType.WORKBENCH);
    table.setMatrix(new ItemStack[] {ingredient, ingredient, ingredient, ingredient});
    table.setResult(ItemStack.of(Material.PRISMARINE));
    var view = Objects.requireNonNull(player.openInventory(table));
    return new PrepareItemCraftEvent(table, view, false);
  }

  @Test
  void shardsNeverCraftIntoPrismarine() {
    var event = prepare(harness.shards.create(1));

    guard.onPrepare(event);

    assertThat(event.getInventory().getResult()).isNull();
  }

  @Test
  void plainPrismarineShardsStillCraft() {
    var event = prepare(ItemStack.of(Material.PRISMARINE_SHARD));

    guard.onPrepare(event);

    assertThat(event.getInventory().getResult()).isEqualTo(ItemStack.of(Material.PRISMARINE));
  }

  private CrafterCraftEvent crafterHolding(ItemStack ingredient) {
    var block = harness.world.getBlockAt(0, 64, 0);
    block.setType(Material.CRAFTER);
    var crafter = (Crafter) block.getState();
    crafter.getInventory().setItem(0, ingredient);
    var result = ItemStack.of(Material.PRISMARINE);
    var recipe =
        new ShapelessRecipe(new NamespacedKey(harness.plugin, "test"), result)
            .addIngredient(4, Material.PRISMARINE_SHARD);
    return new CrafterCraftEvent(block, recipe, result);
  }

  @Test
  void aCrafterHoldingShardsIsStopped() {
    var event = crafterHolding(harness.shards.create(4));

    guard.onCrafter(event);

    assertThat(event.isCancelled()).isTrue();
  }

  @Test
  void aCrafterHoldingPlainShardsRuns() {
    var event = crafterHolding(ItemStack.of(Material.PRISMARINE_SHARD, 4));

    guard.onCrafter(event);

    assertThat(event.isCancelled()).isFalse();
  }
}
