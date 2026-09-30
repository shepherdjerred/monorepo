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
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import java.time.Duration;
import java.util.List;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.jspecify.annotations.Nullable;

/**
 * Player chest shops (ChestShop-style signs on containers), admin sign shops, and the NPC catalog
 * shops. Publishes {@link ServerShops} for the npcs module.
 *
 * <p>Startup installs a fail-closed listener before asynchronously reading shops. Shutdown waits up
 * to {@link #DRAIN_TIMEOUT} for trades in flight to settle.
 */
public final class ShopsModule implements StormModule {

  /** How long shutdown waits for trades in flight before logging them for staff. */
  private static final Duration DRAIN_TIMEOUT = Duration.ofSeconds(5);

  private @Nullable ShutdownDrain drain;
  private @Nullable ComponentLogger logger;

  private record Loaded(List<SignShop> shops, long lastId) {}

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
    var registry = ShopRegistry.loading();
    var installed =
        ShopsPaper.install(context, config, new ShopsPaper.State(registry, store, catalogs));
    context.services().provide(ServerShops.class, installed.serverShops());
    this.drain = installed.drain();
    this.logger = context.logger();
    var _ =
        store
            .loadShops()
            .thenCombine(store.lastShopId(), Loaded::new)
            .whenCompleteAsync(
                (loaded, failure) -> {
                  if (!context.plugin().isEnabled()) {
                    return;
                  }
                  if (failure != null) {
                    context
                        .logger()
                        .error("Shops remain guarded: stored shops could not load", failure);
                    return;
                  }
                  try {
                    registry.initialize(loaded.shops(), loaded.lastId());
                    // A catalog edit or stale sign can close an admin shop. Do this before trading.
                    installed.reconcile().run();
                    registry.publishReady();
                    context.logger().info("Loaded {} shops", loaded.shops().size());
                  } catch (RuntimeException error) {
                    context
                        .logger()
                        .error("Shops remain guarded: startup reconciliation failed", error);
                  }
                },
                context.scheduler().mainThread());
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
}
