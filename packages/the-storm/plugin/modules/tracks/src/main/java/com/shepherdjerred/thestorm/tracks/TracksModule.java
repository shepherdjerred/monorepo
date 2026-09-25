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
import net.luckperms.api.LuckPermsProvider;

/**
 * Progression tracks: players buy levels in five tracks with crystals, levels are stored in SQLite
 * and granted as LuckPerms groups. Publishes {@link TrackLevels} and {@link TrackPurchases}.
 */
public final class TracksModule implements StormModule {

  @Override
  public String id() {
    return "tracks";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("tracks.yml", TracksConfig.class);
    context.database().migrate(id(), TracksModule.class.getClassLoader());
    var wallets = context.services().require(Wallets.class);
    var permissions = new LuckPermsSync(LuckPermsProvider.get());
    var cache = new LevelCache();
    var runtime =
        new TrackRuntime(
            new JooqTrackStore(context.database()),
            permissions,
            cache,
            context.scheduler().mainThread(),
            context.time(),
            context.logger());
    var purchases =
        new PurchaseService(
            runtime, wallets, PurchaseRules.standard(config.pricing(), config.purchaseCooldown()));
    context.services().provide(TrackLevels.class, cache);
    context.services().provide(TrackPurchases.class, purchases);
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
    TracksPaper.install(
        context,
        config,
        new UseCases(purchases, new TrackAdmin(runtime), new TrackSessions(runtime), cache));
  }
}
