package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.shops.adapter.db.JooqShopStore;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.event.block.Action;
import org.junit.jupiter.api.Test;

final class WorldShopSignsTest extends ShopsFixture {
  @Test
  void questionMarkUsesTheFirstStockedItemAndFillsTheOwner() throws Exception {
    var owner = player("Alice", 1);
    var chest = chest(0);
    give(inventoryOf(chest), Material.COBBLESTONE, 64);
    var event = write(owner, signOn(chest), "", "64", "B 10:S 5", "?");
    tick(2);
    assertThat(lines(event)).containsExactly("Alice", "64", "B 10:S 5", "Cobblestone");
    assertThat(storedShops())
        .singleElement()
        .satisfies(
            shop ->
                assertThat(shop.item())
                    .hasValueSatisfying(
                        item -> assertThat(item.material()).isEqualTo("cobblestone")));
  }

  @Test
  void deletingTheDatabaseIndexDoesNotDeleteTheWorldShop() throws Exception {
    var owner = player("Alice", 1);
    var sign = shop(owner, chest(0), "", "16", "B 10", "coal");
    var original = storedShops().getFirst();
    new JooqShopStore(plugin.database()).deleteShop(original.id()).get(10, TimeUnit.SECONDS);
    var rebuilt = new ShopRegistry(List.of(), 0);
    var blocks = new ShopBlocks(plugin, rebuilt, Set.of(Material.CHEST));
    assertThat(blocks.shopAtSign(sign)).contains(original);
    assertThat(rebuilt.all()).containsExactly(original);
    assertThat(blocks.lastWorldId()).isGreaterThanOrEqualTo(original.id());
  }

  @Test
  void visibleQuantityAndPricesOverrideAStaleIndex() throws Exception {
    var owner = player("Alice", 1);
    var sign = shop(owner, chest(0), "", "16", "B 10", "coal");
    var stale = storedShops().getFirst();
    text(sign, "Alice", "32", "B 7:S 3", "Coal");
    var blocks =
        new ShopBlocks(
            plugin, new ShopRegistry(List.of(stale), stale.id()), Set.of(Material.CHEST));
    assertThat(blocks.shopAtSign(sign))
        .hasValueSatisfying(
            shop -> {
              assertThat(shop.quantity()).isEqualTo(32);
              assertThat(shop.prices().buy().orElseThrow().crystals()).isEqualTo(7);
              assertThat(shop.prices().sell().orElseThrow().crystals()).isEqualTo(3);
            });
  }

  @Test
  void anExistingClassicSignCanTradeWithoutAnImportOrPriorShopRow() throws Exception {
    var owner = player("OldOwner", 0);
    var customer = player("Customer", 0);
    setBalance(customer, 20);
    var chest = chest(0);
    give(inventoryOf(chest), Material.COAL, 16);
    var sign = signOn(chest);
    text(sign, owner.getName(), "16", "B 10", "Coal");
    assertThat(storedShops()).isEmpty();
    click(customer, sign, Action.RIGHT_CLICK_BLOCK);
    // Discovery can complete on the first interaction; a second click trades the recovered shop.
    if (count(customer.getInventory(), Material.COAL) == 0) {
      tick(2);
      click(customer, sign, Action.RIGHT_CLICK_BLOCK);
    }
    awaitLine(customer, "You bought");
    assertThat(count(customer.getInventory(), Material.COAL)).isEqualTo(16);
    assertThat(balance(owner)).isEqualTo(10);
  }

  @Test
  void ordinaryTextCannotRetainAStaleShopDefinition() throws Exception {
    var owner = player("Alice", 1);
    var sign = shop(owner, chest(0), "", "16", "B 10", "coal");
    var stale = storedShops().getFirst();
    var registry = new ShopRegistry(List.of(stale), stale.id());
    text(sign, "Welcome", "to", "my", "house");
    assertThat(new ShopBlocks(plugin, registry, Set.of(Material.CHEST)).shopAtSign(sign)).isEmpty();
    assertThat(registry.all()).isEmpty();
  }

  private static void text(Block block, String... lines) {
    var sign = (Sign) block.getState();
    for (var index = 0; index < 4; index++)
      sign.getSide(Side.FRONT).line(index, Component.text(lines[index]));
    assertThat(sign.update()).isTrue();
  }
}
