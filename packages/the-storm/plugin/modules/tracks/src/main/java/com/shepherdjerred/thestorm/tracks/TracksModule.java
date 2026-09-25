package com.shepherdjerred.thestorm.tracks;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.tracks.adapter.db.JooqTrackStore;
import com.shepherdjerred.thestorm.tracks.adapter.luckperms.LuckPermsSync;
import com.shepherdjerred.thestorm.tracks.adapter.paper.TracksPaper;
import com.shepherdjerred.thestorm.tracks.adapter.paper.UseCases;
import com.shepherdjerred.thestorm.tracks.app.LevelCache;
import com.shepherdjerred.thestorm.tracks.app.PurchaseService;
import com.shepherdjerred.thestorm.tracks.app.TrackAdmin;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import com.shepherdjerred.thestorm.tracks.app.TrackPurchases;
import com.shepherdjerred.thestorm.tracks.app.TrackRuntime;
import com.shepherdjerred.thestorm.tracks.app.TrackSessions;
import com.shepherdjerred.thestorm.tracks.domain.TracksConfig;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseRules;
import java.time.Duration;
import net.luckperms.api.LuckPermsProvider;
import org.jspecify.annotations.Nullable;

/**
 * Progression tracks: players buy levels in five tracks with crystals, levels are stored in SQLite
 * and granted as LuckPerms groups. Publishes {@link TrackLevels} and {@link TrackPurchases}.
 */
public final class TracksModule implements StormModule {

  /** How long a stop waits for purchases that have started to be paid and stored or refunded. */
  static final Duration SHUTDOWN_GRACE = Duration.ofSeconds(10);

  private @Nullable PurchaseService purchases;

  @Override
  public String id() {
    return "tracks";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("tracks.yml", TracksConfig.class);
    context.database().migrate(id(), TracksModule.class.getClassLoader());
    var wallets = context.services().require(Wallets.class);
    var store = new JooqTrackStore(context.database());
    var permissions = new LuckPermsSync(LuckPermsProvider.get(), store);
    var cache = new LevelCache();
    var runtime =
        new TrackRuntime(
            store, permissions, cache, context.scheduler(), context.time(), context.logger());
    var service =
        new PurchaseService(
            runtime, wallets, PurchaseRules.standard(config.pricing(), config.purchaseCooldown()));
    purchases = service;
    context.services().provide(TrackLevels.class, cache);
    context.services().provide(TrackPurchases.class, service);
    var _ =
        permissions
            .declareGroups()
            .whenComplete(
                (ignored, failure) -> {
                  if (failure != null) {
                    context
                        .logger()
                        .error(
                            "Could not declare the track groups in LuckPerms; levels grant no"
                                + " permissions until this succeeds",
                            failure);
                  }
                });
    var sessions =
        new TrackSessions(runtime, TracksPaper.loadFailedNotice(context.plugin().getServer()));
    TracksPaper.install(
        context, config, new UseCases(service, new TrackAdmin(runtime), sessions, cache));
  }

  /** Refuses new purchases and lets running ones finish before the database closes. */
  @Override
  public void disable() {
    if (purchases != null) {
      purchases.shutdown(SHUTDOWN_GRACE);
      purchases = null;
    }
  }
}
