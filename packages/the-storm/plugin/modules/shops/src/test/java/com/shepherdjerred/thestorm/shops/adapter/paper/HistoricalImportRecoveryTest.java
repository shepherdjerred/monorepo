package com.shepherdjerred.thestorm.shops.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.shops.adapter.db.JooqShopStore;
import com.shepherdjerred.thestorm.shops.app.ServerShops;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;

final class HistoricalImportRecoveryTest {
  @TempDir Path directory;

  @Test
  void startupClosesAnImportWhoseWorldWriteWasInterrupted() throws Exception {
    var server = MockBukkit.mock();
    try {
      var world = server.addSimpleWorld("shop-test-world");
      var shop =
          new SignShop(
              1,
              new BlockPos(world.getUID(), 0, 65, 0),
              Optional.of(new BlockPos(world.getUID(), 0, 64, 0)),
              new ShopOwner.Player(UUID.randomUUID(), "OldOwner"),
              1,
              ShopPrices.buyOnly(10),
              Optional.of(new ItemFingerprint("diamond", "c3dvcmQ=", true)),
              Instant.parse("2026-09-25T12:00:00Z"));
      try (var database = StormDatabase.open(directory.resolve("t.db"))) {
        database.migrate("shops", JooqShopStore.class.getClassLoader());
        assertThat(new JooqShopStore(database).importHistorical("interrupted", shop).get())
            .isEqualTo(JooqShopStore.HistoricalImport.IMPORTED);
      }

      ShopsTestPlugin.directory = directory;
      var plugin =
          MockBukkit.loadWith(
              ShopsTestPlugin.class,
              new PluginDescriptionFile("TheStorm", "test", ShopsTestPlugin.class.getName()));
      for (var i = 0; i < 400 && !plugin.shopsReady(); i++) {
        server.getScheduler().performOneTick();
        Thread.sleep(5);
      }
      assertThat(plugin.shopsReady()).isTrue();
      var registry = ((ReadyServerShops) plugin.services.require(ServerShops.class)).registry();
      assertThat(registry.byId(1)).contains(shop);
      assertThat(registry.closure(1)).contains("historical import needs staff reconciliation");
      assertThat(new JooqShopStore(plugin.database()).pendingHistoricalShops().get())
          .containsExactly(1L);
    } finally {
      MockBukkit.unmock();
    }
  }
}
