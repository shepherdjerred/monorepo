package com.shepherdjerred.thestorm.shops;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.shops.adapter.content.CatalogDirectory;
import com.shepherdjerred.thestorm.shops.adapter.db.JooqShopStore;
import com.shepherdjerred.thestorm.shops.adapter.paper.ShopsPaper;
import com.shepherdjerred.thestorm.shops.app.ServerShops;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.app.ShutdownDrain;
import com.shepherdjerred.thestorm.shops.domain.config.ShopsConfig;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.jspecify.annotations.Nullable;

/**
 * Player chest shops (ChestShop-style signs on containers), admin sign shops, and the NPC catalog
 * shops. Publishes {@link ServerShops} for the npcs module.
 *
 * <p>The main thread blocks in two places, both bounded and both outside gameplay: {@link #enable}
 * waits up to {@value #LOAD_TIMEOUT_SECONDS} seconds for the shop table (no container may be
 * unguarded once the server ticks), and {@link #disable} waits up to {@link #DRAIN_TIMEOUT} for
 * trades in flight to settle.
 */
public final class ShopsModule implements StormModule {

  /** How long startup waits for the shops to load before refusing to start. */
  private static final long LOAD_TIMEOUT_SECONDS = 30;

  /** How long shutdown waits for trades in flight before logging them for staff. */
  private static final Duration DRAIN_TIMEOUT = Duration.ofSeconds(5);

  private @Nullable ShutdownDrain drain;
  private @Nullable ComponentLogger logger;

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
    var registry = new ShopRegistry(load(store.loadShops()), load(store.lastShopId()));
    var installed =
        ShopsPaper.install(context, config, new ShopsPaper.State(registry, store, catalogs));
    context.services().provide(ServerShops.class, installed.serverShops());
    this.drain = installed.drain();
    this.logger = context.logger();
  }

  @Override
  public void disable() {
    if (drain != null && logger != null) {
      var unsettled = drain.drain(DRAIN_TIMEOUT);
      if (unsettled > 0) {
        logger.error(
            "{} shop trades could not settle before shutdown; see shops_refund_failure", unsettled);
      }
    }
  }

  private static <T> T load(CompletableFuture<T> future) {
    try {
      return future.get(LOAD_TIMEOUT_SECONDS, TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("Interrupted while loading shops", e);
    } catch (ExecutionException | TimeoutException e) {
      throw new IllegalStateException("Could not load shops", e);
    }
  }
}
