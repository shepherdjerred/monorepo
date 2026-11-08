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
import com.shepherdjerred.thestorm.tracks.app.TrackSignals;
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
    context
        .services()
        .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
        .register(id(), runtime::reset);
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
    var signals = new TrackSignals();
    service.watch(signals);
    purchases = service;
    context.services().provide(TrackLevels.class, cache);
    var inspection =
        context
            .services()
            .require(com.shepherdjerred.thestorm.core.capture.CaptureInspection.class);
    for (var track : com.shepherdjerred.thestorm.tracks.app.Track.values()) {
      inspection.registerPlayer(
          "track." + track.name().toLowerCase(java.util.Locale.ROOT),
          id -> {
            var player = context.plugin().getServer().getPlayer(id);
            if (player == null || !cache.isLoaded(id))
              throw new IllegalStateException("Capture player tracks are loading");
            return Integer.toString(cache.level(player, track));
          });
    }
    context.services().provide(TrackPurchases.class, service);
    context.services().provide(TrackSignals.class, signals);
    groups.start();
    var sessions =
        new TrackSessions(runtime, TracksPaper.loadFailedNotice(context.plugin().getServer()));
    sessions.watch(signals);
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
