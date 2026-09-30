package com.shepherdjerred.thestorm.towns;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.protection.SettledLand;
import com.shepherdjerred.thestorm.towns.adapter.bluemap.BlueMapTownMap;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqLocksStore;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqPvpStore;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqTownsStore;
import com.shepherdjerred.thestorm.towns.adapter.paper.TownsPaper;
import com.shepherdjerred.thestorm.towns.app.Clocks;
import com.shepherdjerred.thestorm.towns.app.LockBook;
import com.shepherdjerred.thestorm.towns.app.LockService;
import com.shepherdjerred.thestorm.towns.app.MapSync;
import com.shepherdjerred.thestorm.towns.app.PvpService;
import com.shepherdjerred.thestorm.towns.app.Settling;
import com.shepherdjerred.thestorm.towns.app.TownEvents;
import com.shepherdjerred.thestorm.towns.app.TownListings;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.TownsConfig;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.jspecify.annotations.Nullable;

/**
 * Towns, claims, admin regions, container locks, personal PvP and the land-protection engine.
 * Publishes {@link Protection} for every other module, and draws towns on BlueMap when it is
 * installed.
 *
 * <p>Towns, locks and PvP switches are loaded before any listener is registered and before the port
 * is published, so there is no moment after enable when claimed land or a locked container is
 * unprotected. Enable waits for that load: it runs once at startup, before players can join.
 */
public final class TownsModule implements StormModule {

  /** How long enable waits for stored data before failing the module. */
  private static final long LOAD_TIMEOUT_SECONDS = 30;

  private @Nullable Runnable stopMap;

  @Override
  public String id() {
    return "towns";
  }

  @Override
  public void enable(ModuleContext context) {
    if (Town.MAX_GOVERNOR_LEVEL != Track.MAX_LEVEL) {
      throw new IllegalStateException("towns and tracks disagree on the highest Governor level");
    }
    var config = context.loadConfig("towns.yml", TownsConfig.class);
    context.database().migrate(id(), TownsModule.class.getClassLoader());
    var store = new JooqTownsStore(context.database());
    var lockStore = new JooqLocksStore(context.database());
    var pvpStore = new JooqPvpStore(context.database());
    var state = new TownsState(new RegionIndex(config.regions()));
    state.load(await(store.loadAll(), "towns"));
    var book = new LockBook();
    book.reload(await(lockStore.loadAll(), "locks"));
    var clocks =
        new Clocks(
            context.time(),
            context.random(),
            context.scheduler().mainThread(),
            failure -> {
              context
                  .logger()
                  .error(
                      "Towns could not be reloaded after a failed save; stopping the server"
                          + " because land protection may be stale",
                      failure);
              context.plugin().getServer().shutdown();
            });
    var pvp = new PvpService(pvpStore, config.pvp(), clocks);
    pvp.load(await(pvpStore.loadAll(), "PvP switches"));
    var settling = new Settling(state, store, clocks, mapEvents(context, state));
    var locks =
        new LockService(
            book,
            lockStore,
            new LockService.Dependencies(config.locks(), clocks, settling::isPlayerBusy));
    settling.onSettled(locks::flushDeferred);
    var installed =
        TownsPaper.install(context, new TownsPaper.Loaded(settling, locks, pvp), config);
    context.services().provide(Protection.class, installed.protection());
    context.services().provide(SettledLand.class, installed.settled());
    context.services().provide(TownRead.class, new TownListings(state));
    context
        .logger()
        .info(
            "{} towns, {} locks and {} admin regions loaded",
            state.towns().size(),
            book.all().size(),
            config.regions().size());
  }

  /** Draws towns on BlueMap when it is installed; otherwise nothing listens. */
  private TownEvents mapEvents(ModuleContext context, TownsState state) {
    var server = context.plugin().getServer();
    if (server.getPluginManager().getPlugin("BlueMap") == null) {
      return TownEvents.NONE;
    }
    var blueMap = new BlueMapTownMap(server);
    var sync = new MapSync(state, blueMap);
    blueMap.start(context.scheduler(), sync::redrawAll);
    stopMap = blueMap::stop;
    return sync;
  }

  @Override
  public void disable() {
    var stop = stopMap;
    if (stop != null) {
      stop.run();
      stopMap = null;
    }
  }

  private static <T> T await(CompletableFuture<T> load, String what) {
    try {
      return load.get(LOAD_TIMEOUT_SECONDS, TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("interrupted while loading " + what, e);
    } catch (ExecutionException | TimeoutException e) {
      throw new IllegalStateException("could not load " + what, e);
    }
  }
}
