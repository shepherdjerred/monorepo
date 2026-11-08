package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import java.util.List;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.event.block.Action;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.Test;

final class BundleTradingTest extends ShopsFixture {
  @Test
  void theOriginalMultiItemDealTradesForOnePrice() throws Exception {
    var owner = player("Alice", 1);
    var customer = player("Buyer", 0);
    setBalance(customer, 20);
    var chest = chest(0);
    var sign = shop(owner, chest, "", "1", "B 10:S 5", "coal");
    bundle(sign, List.of(ItemStack.of(Material.COAL, 16), ItemStack.of(Material.DIRT, 32)));
    give(inventoryOf(chest), Material.COAL, 16);
    give(inventoryOf(chest), Material.DIRT, 32);

    click(customer, sign, Action.RIGHT_CLICK_BLOCK);
    awaitLine(customer, "You bought");

    assertThat(count(customer.getInventory(), Material.COAL)).isEqualTo(16);
    assertThat(count(customer.getInventory(), Material.DIRT)).isEqualTo(32);
    assertThat(balance(customer)).isEqualTo(10);
    assertThat(balance(owner)).isEqualTo(10);
    assertThat(inventoryOf(chest).isEmpty()).isTrue();
  }

  @Test
  void aMissingBundleIngredientCannotCauseAPartialPurchase() throws Exception {
    var owner = player("Alice", 1);
    var customer = player("Buyer", 0);
    setBalance(customer, 20);
    var chest = chest(0);
    var sign = shop(owner, chest, "", "1", "B 10", "coal");
    bundle(sign, List.of(ItemStack.of(Material.COAL, 16), ItemStack.of(Material.DIRT, 32)));
    give(inventoryOf(chest), Material.COAL, 16);
    give(inventoryOf(chest), Material.DIRT, 31);

    click(customer, sign, Action.RIGHT_CLICK_BLOCK);
    tick(2);

    assertThat(count(customer.getInventory(), Material.COAL)).isZero();
    assertThat(count(inventoryOf(chest), Material.COAL)).isEqualTo(16);
    assertThat(count(inventoryOf(chest), Material.DIRT)).isEqualTo(31);
    assertThat(balance(customer)).isEqualTo(20);
    assertThat(balance(owner)).isZero();
  }

  @Test
  void differentIngredientsCannotBothClaimTheLastEmptySlot() throws Exception {
    var owner = player("Alice", 1);
    var customer = player("Buyer", 0);
    setBalance(customer, 20);
    for (var slot = 0; slot < 35; slot++)
      customer.getInventory().setItem(slot, ItemStack.of(Material.STONE, 64));
    var chest = chest(0);
    var sign = shop(owner, chest, "", "1", "B 10", "coal");
    bundle(sign, List.of(ItemStack.of(Material.COAL, 16), ItemStack.of(Material.DIRT, 32)));
    give(inventoryOf(chest), Material.COAL, 16);
    give(inventoryOf(chest), Material.DIRT, 32);

    click(customer, sign, Action.RIGHT_CLICK_BLOCK);
    tick(2);

    assertThat(count(customer.getInventory(), Material.COAL)).isZero();
    assertThat(count(inventoryOf(chest), Material.COAL)).isEqualTo(16);
    assertThat(count(inventoryOf(chest), Material.DIRT)).isEqualTo(32);
    assertThat(balance(customer)).isEqualTo(20);
  }

  private void bundle(Block sign, List<ItemStack> contents) throws Exception {
    var original = storedShops().getFirst();
    var offered = original.withItem(new ItemTemplates().bundle(contents));
    var blocks =
        new ShopBlocks(
            plugin, new ShopRegistry(List.of(original), original.id()), Set.of(Material.CHEST));
    blocks.rewrite(sign, offered, offered.lines("Admin Shop"));
  }
}
