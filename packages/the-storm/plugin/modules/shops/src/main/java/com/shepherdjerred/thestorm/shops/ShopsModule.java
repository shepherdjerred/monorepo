package com.shepherdjerred.thestorm.shops;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.shops.adapter.content.CatalogDirectory;
import com.shepherdjerred.thestorm.shops.adapter.db.JooqShopStore;
import com.shepherdjerred.thestorm.shops.adapter.paper.ShopsPaper;
import com.shepherdjerred.thestorm.shops.app.ServerShops;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.domain.config.ShopsConfig;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Player chest shops (ChestShop-style signs on containers), admin sign shops, and the NPC catalog
 * shops. Publishes {@link ServerShops} for the npcs module.
 */
public final class ShopsModule implements StormModule {

  /** How long startup waits for the shops to load before refusing to start. */
  private static final long LOAD_TIMEOUT_SECONDS = 30;

  @Override
  public String id() {
    return "shops";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("shops.yml", ShopsConfig.class);
    var catalogs =
        CatalogDirectory.load(context.dataDirectory().resolve("shops"), ShopsPaper::isItem);
    context.database().migrate(id(), ShopsModule.class.getClassLoader());
    var store = new JooqShopStore(context.database());
    // Loaded before any listener is registered: hoppers and players must never see a shop
    // container unguarded, so startup waits for the (small) table rather than racing it.
    var registry = new ShopRegistry(load(store));
    var serverShops =
        ShopsPaper.install(context, config, new ShopsPaper.State(registry, store, catalogs));
    context.services().provide(ServerShops.class, serverShops);
  }

  private static List<SignShop> load(JooqShopStore store) {
    try {
      return store.loadShops().get(LOAD_TIMEOUT_SECONDS, TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("Interrupted while loading shops", e);
    } catch (ExecutionException | TimeoutException e) {
      throw new IllegalStateException("Could not load shops", e);
    }
  }
}
