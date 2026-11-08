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
import java.util.concurrent.CompletableFuture;
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

  private record Loaded(List<SignShop> shops, long lastId, List<Long> pending) {}

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
    context
        .services()
        .require(com.shepherdjerred.thestorm.core.capture.CaptureInspection.class)
        .register(
            "shops",
            area -> {
              if (!registry.isReady()) throw new IllegalStateException("Shops are loading");
              return registry.all().stream()
                  .filter(
                      shop ->
                          area.contains(
                              shop.sign().world(),
                              shop.sign().x(),
                              shop.sign().y(),
                              shop.sign().z()))
                  .map(shop -> Long.toString(shop.id()))
                  .sorted()
                  .collect(java.util.stream.Collectors.joining(","));
            });
    var installed =
        ShopsPaper.install(context, config, new ShopsPaper.State(registry, store, catalogs));
    context.services().provide(ServerShops.class, installed.serverShops());
    com.shepherdjerred.thestorm.shops.adapter.paper.HistoricalShopOperations.install(
        context,
        config,
        new com.shepherdjerred.thestorm.shops.adapter.paper.HistoricalShopOperations.State(
            registry, store, catalogs));
    var reset =
        new com.shepherdjerred.thestorm.shops.adapter.db.JooqPlayerReset(context.database());
    context
        .services()
        .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
        .register(
            id(),
            player ->
                reset
                    .reset(player)
                    .thenRunAsync(
                        () -> installed.forget().accept(player), context.scheduler().mainThread()));
    this.drain = installed.drain();
    this.logger = context.logger();
    var shops = store.loadShops();
    var lastId = store.lastShopId();
    var pending = store.pendingHistoricalShops();
    var _ =
        CompletableFuture.allOf(
                shops,
                lastId,
                pending,
                context
                    .services()
                    .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
                    .epochs()
                    .loaded())
            .thenApply(ignored -> new Loaded(shops.join(), lastId.join(), pending.join()))
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
                    closeInterrupted(context, registry, loaded.pending());
                    registry.publishReady();
                    installed.reconcile().run();
                    context.logger().info("Indexed {} world shops", registry.all().size());
                  } catch (RuntimeException error) {
                    registry.suspend();
                    context
                        .logger()
                        .error("Shops remain guarded: startup reconciliation failed", error);
                  }
                },
                context.scheduler().mainThread());
  }

  private static void closeInterrupted(
      ModuleContext context, ShopRegistry registry, List<Long> ids) {
    for (var id : ids) {
      registry.retainClosure(id, "historical import needs staff reconciliation");
      context.logger().error("Historical shop {} has an interrupted import; it remains closed", id);
    }
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
