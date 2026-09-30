package com.shepherdjerred.thestorm.tracks;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.tracks.adapter.db.JooqTrackStore;
import com.shepherdjerred.thestorm.tracks.adapter.luckperms.LuckPermsSync;
import com.shepherdjerred.thestorm.tracks.adapter.paper.TracksPaper;
import com.shepherdjerred.thestorm.tracks.adapter.paper.TracksPermissions;
import com.shepherdjerred.thestorm.tracks.adapter.paper.UseCases;
import com.shepherdjerred.thestorm.tracks.app.LevelCache;
import com.shepherdjerred.thestorm.tracks.app.PurchaseService;
import com.shepherdjerred.thestorm.tracks.app.TrackAdmin;
import com.shepherdjerred.thestorm.tracks.app.TrackGroupDeclarations;
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
  private @Nullable TrackGroupDeclarations declarations;
  private @Nullable TrackRuntime runtime;
  private @Nullable TracksPermissions registered;

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
            store,
            permissions,
            cache,
            new TrackRuntime.RuntimeServices(
                context.scheduler(), context.time(), context.logger()));
    this.runtime = runtime;
    var groups =
        new TrackGroupDeclarations(
            permissions,
            context.scheduler(),
            context.logger(),
            () ->
                context
                    .plugin()
                    .getServer()
                    .getOnlinePlayers()
                    .forEach(player -> runtime.syncPermissions(player.getUniqueId())));
    declarations = groups;
    var service =
        new PurchaseService(
            runtime,
            wallets,
            PurchaseRules.standard(config.pricing(), config.purchaseCooldown()),
            groups::ready);
    purchases = service;
    context.services().provide(TrackLevels.class, cache);
    context.services().provide(TrackPurchases.class, service);
    groups.start();
    var sessions =
        new TrackSessions(runtime, TracksPaper.loadFailedNotice(context.plugin().getServer()));
    registered =
        TracksPaper.install(
            context, config, new UseCases(service, new TrackAdmin(runtime), sessions, cache));
  }

  /**
   * Refuses new purchases, lets running ones finish before the database closes, and unregisters the
   * permissions.
   */
  @Override
  public void disable() {
    if (declarations != null) {
      declarations.stop();
      declarations = null;
    }
    if (runtime != null) {
      runtime.stop();
      runtime = null;
    }
    if (registered != null) {
      registered.unregister();
      registered = null;
    }
    if (purchases != null) {
      purchases.shutdown(SHUTDOWN_GRACE);
      purchases = null;
    }
  }
}
