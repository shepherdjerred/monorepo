package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.Entry;
import com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.Point;
import com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.SignFormat;
import com.shepherdjerred.thestorm.shops.adapter.db.JooqShopStore;
import com.shepherdjerred.thestorm.shops.app.ServerShops;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import java.time.InstantSource;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.Container;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.event.block.Action;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.Test;

final class HistoricalShopsTest extends ShopsFixture {
  private static final UUID OWNER = UUID.fromString("c538a540-3e91-4680-9e98-43f4d811e8e2");

  private Entry entry() {
    return new Entry(
        "old-shop",
        world.getName(),
        new Point(0, 64, 1),
        new Point(0, 64, 0),
        OWNER,
        "Pigrider102",
        "diamond",
        1,
        18,
        16,
        "Diamond",
        SignFormat.QUANTITY_ITEM,
        com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.Details.LEGACY);
  }

  private Block oldSign() {
    var signBlock = signOn(chest(0));
    var sign = (Sign) signBlock.getState();
    var side = sign.getSide(Side.FRONT);
    var lines = entry().expectedLines();
    for (var i = 0; i < lines.size(); i++) side.line(i, Component.text(lines.get(i)));
    sign.update();
    return signBlock;
  }

  private void finish(CompletableFuture<?> operation) throws Exception {
    for (var i = 0; i < 400 && !operation.isDone(); i++) {
      server.getScheduler().performOneTick();
      Thread.sleep(5);
    }
    assertThat(operation.isDone()).isTrue();
    operation.get();
  }

  private HistoricalShops importer(ShopRegistry registry, ShopBlocks blocks, JooqShopStore store) {
    return new HistoricalShops(
        new HistoricalShops.Services(
            plugin,
            registry,
            blocks,
            store,
            plugin.protection,
            new com.shepherdjerred.thestorm.shops.app.ServerOffers(List.of(), registry)),
        new HistoricalShops.ImportRuntime(
            task -> server.getScheduler().runTask(plugin, task),
            InstantSource.system(),
            plugin.getComponentLogger(),
            (ignored, x, z) -> CompletableFuture.completedFuture(null),
            java.util.Map.of()));
  }

  @Test
  void staffCustodyPreservesAnOriginalItemTemplateAndShowsActualTradeTerms() throws Exception {
    var sign = oldSign();
    var raw = List.of("[buy]", "1 Old Sword", "for", "$50");
    var state = (Sign) sign.getState();
    for (var i = 0; i < 4; i++) state.getSide(Side.FRONT).line(i, Component.text(raw.get(i)));
    state.update();
    var original = ItemStack.of(Material.DIAMOND_SWORD);
    original.addUnsafeEnchantment(org.bukkit.enchantments.Enchantment.SHARPNESS, 2);
    var chestBlock = world.getBlockAt(0, 64, 0);
    var chest = (Container) chestBlock.getState();
    chest.getSnapshotInventory().setItem(3, original);
    chest.update();
    var entry =
        new Entry(
            "custody-sword",
            world.getName(),
            new Point(0, 64, 1),
            new Point(0, 64, 0),
            com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.STAFF_CUSTODY,
            "Staff custody",
            "diamond_sword",
            1,
            50,
            4,
            "Old Sword",
            SignFormat.QUANTITY_ITEM,
            new com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.Details(
                raw, 3, false, true));
    plugin.protection.denied.add(com.shepherdjerred.thestorm.core.protection.ProtectedAction.BUILD);
    plugin.protection.denied.add(
        com.shepherdjerred.thestorm.core.protection.ProtectedAction.OPEN_CONTAINER);
    var registry = new ShopRegistry(List.of(), 0);
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var store = new JooqShopStore(plugin.database());
    var importer = importer(registry, blocks, store);
    finish(importer.restore(List.of(entry)));
    var restored = blocks.shopAtSign(sign).orElseThrow();
    assertThat(restored.owner()).isEqualTo(new ShopOwner.Admin(true));
    assertThat(new ItemTemplates().template(restored.item().orElseThrow()).isSimilar(original))
        .isTrue();
    assertThat(plain(((Sign) sign.getState()).getSide(Side.FRONT).line(0)))
        .isEqualTo("Staff custody");
    assertThat(count(inventoryOf(chestBlock), Material.DIAMOND_SWORD)).isEqualTo(4);
    finish(importer.restore(List.of(entry)));
    assertThat(count(inventoryOf(chestBlock), Material.DIAMOND_SWORD)).isEqualTo(4);
  }

  @Test
  void aMissingOriginalTemplateDoesNotBlockTheFollowingListing() throws Exception {
    var first = oldSign();
    var original = entry();
    var missing =
        new Entry(
            original.id(),
            original.world(),
            original.sign(),
            original.container(),
            original.owner(),
            original.ownerName(),
            original.item(),
            original.quantity(),
            original.price(),
            original.stockTarget(),
            original.historicalItemName(),
            original.signFormat(),
            new com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.Details(
                original.expectedLines(), 0, false, true));
    var next =
        new Entry(
            "next-shop",
            world.getName(),
            new Point(4, 64, 1),
            new Point(4, 64, 0),
            OWNER,
            "Pigrider102",
            "diamond",
            1,
            18,
            16,
            "Diamond",
            SignFormat.QUANTITY_ITEM,
            com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.Details.LEGACY);
    var second = signOn(chest(4));
    var state = (Sign) second.getState();
    for (var index = 0; index < 4; index++)
      state.getSide(Side.FRONT).line(index, Component.text(next.expectedLines().get(index)));
    state.update();
    var registry = new ShopRegistry(List.of(), 0);
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var store = new JooqShopStore(plugin.database());
    finish(importer(registry, blocks, store).restore(List.of(missing, next)));
    assertThat(registry.atSign(ShopBlocks.pos(first))).isEmpty();
    assertThat(registry.atSign(ShopBlocks.pos(second))).isPresent();
    assertThat(count(inventoryOf(world.getBlockAt(4, 64, 0)), Material.DIAMOND)).isEqualTo(16);
    assertThat(store.pendingHistoricalShops().get()).isEmpty();
    assertThat(store.completedHistoricalShops().get()).containsOnlyKeys("next-shop");
  }

  @Test
  void convertsAWholeBowAndArrowsDealAndStocksEachPartOnlyOnce() throws Exception {
    var sign = oldSign();
    var raw = List.of("[Buy]", "1 Bow &", "32 Arrows", "10 Cr");
    var state = (Sign) sign.getState();
    for (var i = 0; i < 4; i++) state.getSide(Side.FRONT).line(i, Component.text(raw.get(i)));
    state.update();
    var original = ItemStack.of(Material.BOW);
    original.addUnsafeEnchantment(org.bukkit.enchantments.Enchantment.POWER, 2);
    var chest = world.getBlockAt(0, 64, 0);
    var initial = (Container) chest.getState();
    initial.getSnapshotInventory().setItem(22, original);
    initial.getSnapshotInventory().setItem(23, ItemStack.of(Material.ARROW, 32));
    initial.update();
    var entry =
        new Entry(
            "bow-and-arrows",
            world.getName(),
            new Point(0, 64, 1),
            new Point(0, 64, 0),
            OWNER,
            "Pigrider102",
            "bow",
            1,
            10,
            8,
            "Bow and 32 Arrows",
            SignFormat.BOW_WITH_ARROWS,
            new com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.Details(
                raw, 22, false, true));
    var registry = new ShopRegistry(List.of(), 0);
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var importer = importer(registry, blocks, new JooqShopStore(plugin.database()));
    finish(importer.restore(List.of(entry)));
    var restored = blocks.shopAtSign(sign).orElseThrow();
    var parts = new ItemTemplates().bundleItems(restored.item().orElseThrow());
    assertThat(parts).hasSize(2);
    assertThat(parts.getFirst().isSimilar(original)).isTrue();
    assertThat(parts.getLast()).isEqualTo(ItemStack.of(Material.ARROW, 32));
    assertThat(plain(((Sign) sign.getState()).getSide(Side.FRONT).line(3)))
        .isEqualTo("Bundle deal");
    assertThat(count(inventoryOf(chest), Material.BOW)).isEqualTo(8);
    assertThat(count(inventoryOf(chest), Material.ARROW)).isEqualTo(256);
    finish(importer.restore(List.of(entry)));
    assertThat(count(inventoryOf(chest), Material.BOW)).isEqualTo(8);
    assertThat(count(inventoryOf(chest), Material.ARROW)).isEqualTo(256);
  }

  @Test
  void importsStockedOriginalSignForItsHistoricalOwnerOnlyOnce() throws Exception {
    var sign = oldSign();
    var chest = world.getBlockAt(0, 64, 0);
    var initial = (Container) chest.getState();
    initial.getSnapshotInventory().setItem(0, ItemStack.of(Material.DIAMOND, 3));
    initial.getSnapshotInventory().setItem(1, ItemStack.of(Material.GOLD_INGOT, 4));
    initial.update();
    var registry = new ShopRegistry(List.of(), 0);
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var store = new JooqShopStore(plugin.database());
    var importer = importer(registry, blocks, store);
    finish(importer.restore(List.of(entry())));

    var shop = blocks.shopAtSign(sign).orElseThrow();
    assertThat(shop.owner()).isEqualTo(new ShopOwner.Player(OWNER, "Pigrider102"));
    assertThat(shop.prices().buy().orElseThrow().crystals()).isEqualTo(18);
    assertThat(store.loadShops().get()).containsExactly(shop);
    assertThat(store.pendingHistoricalShops().get()).isEmpty();
    assertThat(count(((Container) chest.getState()).getInventory(), Material.DIAMOND))
        .isEqualTo(16);
    assertThat(count(((Container) chest.getState()).getInventory(), Material.GOLD_INGOT))
        .isEqualTo(4);
    finish(importer.restore(List.of(entry())));
    assertThat(count(((Container) chest.getState()).getInventory(), Material.DIAMOND))
        .isEqualTo(16);
  }

  @Test
  void aCompletedReceiptWithMissingWorldStockClosesTheShopOnStartup() throws Exception {
    var sign = oldSign();
    var chest = world.getBlockAt(0, 64, 0);
    var registry = new ShopRegistry(List.of(), 0);
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var store = new JooqShopStore(plugin.database());
    finish(importer(registry, blocks, store).restore(List.of(entry())));
    var shop = blocks.shopAtSign(sign).orElseThrow();
    assertThat(store.completedHistoricalShops().get()).containsEntry(entry().id(), shop.id());

    var restarted = new ShopRegistry(store.loadShops().get(), shop.id());
    var restartedBlocks = new ShopBlocks(plugin, restarted, Set.of(Material.CHEST));
    var recovery =
        new HistoricalShops(
            new HistoricalShops.Services(
                plugin,
                restarted,
                restartedBlocks,
                store,
                plugin.protection,
                new com.shepherdjerred.thestorm.shops.app.ServerOffers(List.of(), restarted)),
            new HistoricalShops.ImportRuntime(
                task -> server.getScheduler().runTask(plugin, task),
                InstantSource.system(),
                plugin.getComponentLogger(),
                (ignored, x, z) -> CompletableFuture.completedFuture(null),
                store.completedHistoricalShops().get()));
    finish(recovery.restore(List.of(entry())));
    assertThat(restarted.closure(shop.id())).isEmpty();

    // Model a chest chunk that did not retain its stock/marker after the receipt committed.
    chest.setType(Material.AIR);
    chest.setType(Material.CHEST);
    finish(recovery.restore(List.of(entry())));
    assertThat(restarted.closure(shop.id()))
        .contains("historical shop world data needs staff reconciliation");
    assertThat(count(((Container) chest.getState()).getInventory(), Material.DIAMOND)).isZero();
  }

  @Test
  void changedSignsAndDeniedContainersAreNotImported() throws Exception {
    var sign = oldSign();
    var registry = new ShopRegistry(List.of(), 0);
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var store = new JooqShopStore(plugin.database());
    var importer = importer(registry, blocks, store);
    plugin.protection.denied.add(ProtectedAction.OPEN_CONTAINER);
    finish(importer.restore(List.of(entry())));
    assertThat(store.loadShops().get()).isEmpty();
    plugin.protection.denied.clear();
    var changed = (Sign) sign.getState();
    changed.getSide(Side.FRONT).line(3, Component.text("19"));
    changed.update();
    finish(importer.restore(List.of(entry())));
    assertThat(store.loadShops().get()).isEmpty();
  }

  @Test
  void aCustomerBuysFromTheHistoricalOwner() throws Exception {
    var sign = oldSign();
    var registry = ((ReadyServerShops) plugin.services.require(ServerShops.class)).registry();
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var store = new JooqShopStore(plugin.database());
    finish(importer(registry, blocks, store).restore(List.of(entry())));
    var buyer = player("Buyer", 0);
    setBalance(buyer, 100);
    click(buyer, sign, Action.RIGHT_CLICK_BLOCK);
    assertThat(awaitLine(buyer, "You bought"))
        .containsExactly("[Shop]: You bought 1 Diamond from Pigrider102's shop for 18 crystals.");
    assertThat(count(buyer.getInventory(), Material.DIAMOND)).isEqualTo(1);
    assertThat(balance(buyer)).isEqualTo(82);
    assertThat(plugin.wallets.balanceOf(new AccountId.Player(OWNER))).isEqualTo(18);
  }

  @Test
  void sharedContainerKeepsBothProductsAvailableToTheirSigns() throws Exception {
    var firstSign = oldSign();
    var second =
        new Entry(
            "old-gold-shop",
            world.getName(),
            new Point(1, 64, 1),
            new Point(0, 64, 0),
            OWNER,
            "Pigrider102",
            "gold_ingot",
            1,
            10,
            16,
            "Gold Ingot",
            SignFormat.QUANTITY_ITEM,
            com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.Details.LEGACY);
    var support = world.getBlockAt(1, 64, 0);
    support.setType(Material.STONE);
    var secondSign = signOn(support);
    var state = (Sign) secondSign.getState();
    for (var i = 0; i < second.expectedLines().size(); i++) {
      state.getSide(Side.FRONT).line(i, Component.text(second.expectedLines().get(i)));
    }
    state.update();
    var registry = ((ReadyServerShops) plugin.services.require(ServerShops.class)).registry();
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    finish(
        importer(registry, blocks, new JooqShopStore(plugin.database()))
            .restore(List.of(entry(), second)));
    var diamondBuyer = player("DiamondBuyer", 0);
    var goldBuyer = player("GoldBuyer", 0);
    setBalance(diamondBuyer, 100);
    setBalance(goldBuyer, 100);
    click(diamondBuyer, firstSign, Action.RIGHT_CLICK_BLOCK);
    assertThat(awaitLine(diamondBuyer, "You bought")).hasSize(1);
    click(goldBuyer, secondSign, Action.RIGHT_CLICK_BLOCK);
    assertThat(awaitLine(goldBuyer, "You bought")).hasSize(1);
    assertThat(count(diamondBuyer.getInventory(), Material.DIAMOND)).isEqualTo(1);
    assertThat(count(goldBuyer.getInventory(), Material.GOLD_INGOT)).isEqualTo(1);
    var inventory = ((Container) world.getBlockAt(0, 64, 0).getState()).getInventory();
    assertThat(count(inventory, Material.DIAMOND)).isEqualTo(15);
    assertThat(count(inventory, Material.GOLD_INGOT)).isEqualTo(15);
    assertThat(plugin.wallets.balanceOf(new AccountId.Player(OWNER))).isEqualTo(28);
  }

  @Test
  void playerShopCanBeCreatedWhileHistoricalImportIsWaitingForTheDatabase() throws Exception {
    var historicSign = oldSign();
    var registry = ((ReadyServerShops) plugin.services.require(ServerShops.class)).registry();
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var store = new JooqShopStore(plugin.database());
    var hold = new java.util.concurrent.CountDownLatch(1);
    var writerStarted = new java.util.concurrent.CountDownLatch(1);
    var blocker =
        plugin
            .database()
            .write(
                ignored -> {
                  writerStarted.countDown();
                  try {
                    if (!hold.await(10, java.util.concurrent.TimeUnit.SECONDS))
                      throw new IllegalStateException("Database hold timed out");
                  } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(error);
                  }
                  return 0;
                });
    assertThat(writerStarted.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
    try {
      var restore = importer(registry, blocks, store).restore(List.of(entry()));
      for (var i = 0; i < 100 && registry.nextId() == 1; i++) {
        server.getScheduler().performOneTick();
        Thread.sleep(5);
      }
      assertThat(registry.nextId()).isEqualTo(2);
      var player = player("NewShopkeeper", 1);
      var playerSign = shop(player, chest(10), "", "1", "B 5", "coal");
      assertThat(registry.atSign(ShopBlocks.pos(playerSign))).isPresent();
      assertThat(registry.atSign(ShopBlocks.pos(playerSign)).orElseThrow().id()).isEqualTo(2);
      hold.countDown();
      finish(restore);
      blocker.get();
      assertThat(blocks.shopAtSign(historicSign).orElseThrow().id()).isEqualTo(1);
      assertThat(storedShops()).hasSize(2);
    } finally {
      hold.countDown();
    }
  }

  @Test
  void aCustomerBuysFromAStocked2016FormatSign() throws Exception {
    var entry =
        new Entry(
            "map2-shop",
            world.getName(),
            new Point(0, 64, 1),
            new Point(0, 64, 0),
            OWNER,
            "Detern",
            "cobblestone",
            32,
            15,
            1024,
            "Cobblestone",
            SignFormat.QUANTITY_ITEM_FOR_PRICE,
            com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.Details.LEGACY);
    var sign = signOn(chest(0));
    var state = (Sign) sign.getState();
    for (var i = 0; i < entry.expectedLines().size(); i++) {
      state.getSide(Side.FRONT).line(i, Component.text(entry.expectedLines().get(i)));
    }
    state.update();
    var registry = ((ReadyServerShops) plugin.services.require(ServerShops.class)).registry();
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    finish(
        importer(registry, blocks, new JooqShopStore(plugin.database())).restore(List.of(entry)));
    var buyer = player("Buyer", 0);
    setBalance(buyer, 100);
    click(buyer, sign, Action.RIGHT_CLICK_BLOCK);
    assertThat(awaitLine(buyer, "You bought"))
        .containsExactly("[Shop]: You bought 32 Cobblestone from Detern's shop for 15 crystals.");
    assertThat(count(buyer.getInventory(), Material.COBBLESTONE)).isEqualTo(32);
    assertThat(
            count(
                ((Container) world.getBlockAt(0, 64, 0).getState()).getInventory(),
                Material.COBBLESTONE))
        .isEqualTo(992);
    assertThat(plugin.wallets.balanceOf(new AccountId.Player(OWNER))).isEqualTo(15);
  }

  @Test
  void fullChestsDoNotProduceAnUnstockedShopAndCanBeRetried() throws Exception {
    var sign = oldSign();
    var chest = world.getBlockAt(0, 64, 0);
    var initial = (Container) chest.getState();
    var inventory = initial.getSnapshotInventory();
    for (var i = 0; i < inventory.getSize(); i++) {
      inventory.setItem(i, ItemStack.of(Material.COBBLESTONE, 64));
    }
    initial.update();
    var registry = new ShopRegistry(List.of(), 0);
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var store = new JooqShopStore(plugin.database());
    var importer = importer(registry, blocks, store);
    server.getPluginManager().registerEvents(importer, plugin);
    finish(importer.restore(List.of(entry())));
    assertThat(store.loadShops().get()).isEmpty();
    assertThat(store.pendingHistoricalShops().get()).isEmpty();
    assertThat(blocks.shopAtSign(sign)).isEmpty();

    var cleared = (Container) chest.getState();
    cleared.getSnapshotInventory().clear(0);
    cleared.update();
    importer.containerChanged(ShopBlocks.containerBlocks(chest));
    for (var i = 0; i < 400 && blocks.shopAtSign(sign).isEmpty(); i++) {
      server.getScheduler().performOneTick();
      Thread.sleep(5);
    }
    assertThat(blocks.shopAtSign(sign)).isPresent();
    assertThat(count(((Container) chest.getState()).getInventory(), Material.DIAMOND))
        .isEqualTo(16);
  }

  @Test
  void missingContainerCanBeAddedWithoutRestarting() throws Exception {
    var sign = oldSign();
    var chest = world.getBlockAt(0, 64, 0);
    chest.setType(Material.AIR);
    var registry = new ShopRegistry(List.of(), 0);
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var store = new JooqShopStore(plugin.database());
    var importer = importer(registry, blocks, store);
    finish(importer.restore(List.of(entry())));
    assertThat(store.loadShops().get()).isEmpty();
    chest.setType(Material.CHEST);
    importer.containerChanged(ShopBlocks.containerBlocks(chest));
    for (var i = 0; i < 400 && blocks.shopAtSign(sign).isEmpty(); i++) {
      server.getScheduler().performOneTick();
      Thread.sleep(5);
    }
    assertThat(blocks.shopAtSign(sign)).isPresent();
    assertThat(count(((Container) chest.getState()).getInventory(), Material.DIAMOND))
        .isEqualTo(16);
  }

  @Test
  void containerFixedDuringStartupIsRetriedAfterReadiness() throws Exception {
    var sign = oldSign();
    var chest = world.getBlockAt(0, 64, 0);
    chest.setType(Material.AIR);
    var registry = ShopRegistry.loading();
    registry.initialize(List.of(), 0);
    var blocks = new ShopBlocks(plugin, registry, Set.of(Material.CHEST));
    var store = new JooqShopStore(plugin.database());
    var importer = importer(registry, blocks, store);
    finish(importer.restore(List.of(entry())));

    chest.setType(Material.CHEST);
    importer.containerChanged(ShopBlocks.containerBlocks(chest));
    server.getScheduler().performOneTick();
    assertThat(blocks.shopAtSign(sign)).isEmpty();
    registry.publishReady();
    importer.retryChangedContainers();
    for (var i = 0; i < 400 && blocks.shopAtSign(sign).isEmpty(); i++) {
      server.getScheduler().performOneTick();
      Thread.sleep(5);
    }
    assertThat(blocks.shopAtSign(sign)).isPresent();
    assertThat(count(((Container) chest.getState()).getInventory(), Material.DIAMOND))
        .isEqualTo(16);
  }
}
