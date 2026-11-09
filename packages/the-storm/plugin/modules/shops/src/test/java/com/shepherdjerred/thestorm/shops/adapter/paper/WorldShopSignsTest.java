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
  void anInterruptedShopStaysClosedWhileItsNeighboringChestChunkIsUnloaded() throws Exception {
    var owner = player("Alice", 1);
    var chest = chest(16);
    var sign = world.getBlockAt(15, 64, 0);
    sign.setType(Material.OAK_WALL_SIGN);
    sign.setBlockData(server.createBlockData("minecraft:oak_wall_sign[facing=west]"));
    var shop =
        new com.shepherdjerred.thestorm.shops.domain.shop.SignShop(
            7,
            ShopBlocks.pos(sign),
            java.util.Optional.of(ShopBlocks.pos(chest)),
            new com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner.Player(
                owner.getUniqueId(), "Alice"),
            1,
            com.shepherdjerred.thestorm.shops.domain.price.ShopPrices.buyOnly(10),
            java.util.Optional.of(new ItemTemplates().plain(Material.COAL)),
            java.time.Instant.EPOCH);
    var registry = new ShopRegistry(List.of(shop), 7);
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    blocks.rewrite(sign, shop, shop.lines("Admin Shop"));
    // A second, still-loaded chest must never replace the chosen chest during unloading.
    world.getBlockAt(15, 63, 0).setType(Material.CHEST);
    registry.close(7, "interrupted import");
    blocks.discovery(
        ignored -> {
          throw new AssertionError("an identified sign cannot get a replacement identity");
        },
        ignored -> {});
    world.unloadChunk(1, 0);
    assertThat(blocks.shopAtSign(sign)).isEmpty();
    assertThat(registry.closure(7)).contains("interrupted import");
    world.loadChunk(1, 0);
    assertThat(blocks.shopAtSign(sign)).contains(shop);
    assertThat(registry.closure(7)).contains("interrupted import");
    chest.setType(Material.AIR);
    assertThat(blocks.shopAtSign(sign)).isEmpty();
    assertThat(world.isChunkLoaded(1, 0)).isTrue();
  }

  @Test
  void aLateRecoveredUnlimitedShopIsClosedWhenItsPricesLoopWithTheCatalog() throws Exception {
    var sign = signOn(chest(32));
    var registry = new ShopRegistry(List.of(), 0);
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var templates = new ItemTemplates();
    var shop =
        new com.shepherdjerred.thestorm.shops.domain.shop.SignShop(
            7,
            ShopBlocks.pos(sign),
            blocks.connectedContainer(sign).map(ShopBlocks::pos),
            new com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner.Admin(),
            1,
            com.shepherdjerred.thestorm.shops.domain.price.ShopPrices.buyOnly(1),
            java.util.Optional.of(templates.plain(Material.DIAMOND)),
            java.time.Instant.EPOCH);
    blocks.rewrite(sign, shop, shop.lines("Admin Shop"));
    var catalogs =
        com.shepherdjerred.thestorm.shops.adapter.content.CatalogDirectory.load(
            ShopsTestPlugin.OWNED.resolve("shops"), ShopsPaper::isItem);
    new WorldShopDiscovery(
        plugin.context(),
        blocks,
        new JooqShopStore(plugin.database()),
        new WorldShopDiscovery.Parsing(
            new com.shepherdjerred.thestorm.shops.domain.sign.ShopSignParser(64, "Admin Shop"),
            templates,
            new com.shepherdjerred.thestorm.shops.app.ServerOffers(catalogs, registry)));
    world.unloadChunk(2, 0);
    assertThat(blocks.shopAtSign(sign)).isEmpty();
    world.loadChunk(2, 0);
    assertThat(blocks.shopAtSign(sign)).contains(shop);
    assertThat(registry.closure(7)).isPresent();
    registry.retainClosure(7, "interrupted import");
    registry.evict(7);
    assertThat(blocks.shopAtSign(sign)).contains(shop);
    assertThat(registry.closure(7)).contains("interrupted import");
    assertThat(storedShops()).contains(shop);
  }

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
        .satisfies(shop ->
            assertThat(shop.item())
                .hasValueSatisfying(item -> assertThat(item.material()).isEqualTo("cobblestone")));
  }

  @Test
  void resetRevokesWorldDefinitionsEvenWhenTheShopIndexIsEmpty() throws Exception {
    var owner = player("Alice", 1);
    var sign = shop(owner, chest(0), "", "16", "B 10", "coal");
    var resets =
        plugin.services.require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class);
    resets.stateless("core");
    resets.complete(Set.of("shops"));
    var resetting = resets.reset(owner.getUniqueId());
    for (var attempt = 0; attempt < 400 && !resetting.isDone(); attempt++) {
      tick(1);
      Thread.sleep(5);
    }
    resetting.get(5, TimeUnit.SECONDS);
    var epochs = resets.epochs();
    var blocks =
        new ShopBlocks(plugin, new ShopRegistry(List.of(), 0), Set.of(Material.CHEST), epochs);
    assertThat(blocks.shopAtSign(sign)).isEmpty();
    // Returning players may explicitly author a fresh shop in the new account generation.
    var fresh = shop(owner, chest(4), "", "16", "B 10", "coal");
    assertThat(blocks.shopAtSign(fresh)).isPresent();
  }

  @Test
  void containerDiscoveryDoesNotLoadANeighboringChunk() {
    var chest = chest(16);
    var sign = world.getBlockAt(15, 64, 0);
    sign.setType(Material.OAK_WALL_SIGN);
    sign.setBlockData(server.createBlockData("minecraft:oak_wall_sign[facing=west]"));
    world.unloadChunk(1, 0);
    assertThat(world.isChunkLoaded(1, 0)).isFalse();
    var blocks = new ShopBlocks(plugin, new ShopRegistry(List.of(), 0), Set.of(Material.CHEST));
    assertThat(blocks.connectedContainer(sign)).isEmpty();
    assertThat(world.isChunkLoaded(1, 0)).isFalse();
    assertThat(chest.getX()).isEqualTo(16);
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
        .hasValueSatisfying(shop -> {
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
