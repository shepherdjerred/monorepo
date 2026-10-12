package com.shepherdjerred.thestorm.towns;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.protection.SettledLand;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.towns.adapter.bluemap.BlueMapTownMap;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqLeaseStore;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqLocksStore;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqPvpStore;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqRecoveryStore;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqTownsStore;
import com.shepherdjerred.thestorm.towns.adapter.paper.TownsPaper;
import com.shepherdjerred.thestorm.towns.adapter.remote.FliptRentalGate;
import com.shepherdjerred.thestorm.towns.app.Clocks;
import com.shepherdjerred.thestorm.towns.app.LockBook;
import com.shepherdjerred.thestorm.towns.app.LockService;
import com.shepherdjerred.thestorm.towns.app.MapSync;
import com.shepherdjerred.thestorm.towns.app.ParcelBook;
import com.shepherdjerred.thestorm.towns.app.PlotRentals;
import com.shepherdjerred.thestorm.towns.app.PvpService;
import com.shepherdjerred.thestorm.towns.app.RentalGate;
import com.shepherdjerred.thestorm.towns.app.Settling;
import com.shepherdjerred.thestorm.towns.app.TownEvents;
import com.shepherdjerred.thestorm.towns.app.TownListings;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.TownsConfig;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelsConfig;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.net.URI;
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
  private @Nullable FliptRentalGate rentalGate;

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
    var parcelsConfig = context.loadConfig("parcels.yml", ParcelsConfig.class);
    TownsPaper.requireWorlds(context.plugin().getServer(), config, parcelsConfig);
    context.database().migrate(id(), TownsModule.class.getClassLoader());
    var store = new JooqTownsStore(context.database());
    var lockStore = new JooqLocksStore(context.database());
    var pvpStore = new JooqPvpStore(context.database());
    var state = new TownsState(new RegionIndex(config.regions()));
    var heritage =
        context.loadConfig(
            "heritage.yml", com.shepherdjerred.thestorm.towns.domain.heritage.HeritageConfig.class);
    for (var site : heritage.sites()) {
      if (context.plugin().getServer().getWorld(site.world()) == null) {
        throw new IllegalStateException("heritage world is not loaded: " + site.world());
      }
    }
    state.attachHeritage(
        new com.shepherdjerred.thestorm.towns.domain.heritage.HeritageIndex(heritage.sites()));
    state.load(await(store.loadAll(), "towns"));
    var leases = new JooqLeaseStore(context.database());
    var parcels = new ParcelBook(parcelsConfig, context.time());
    parcels.load(await(leases.load(), "plot leases"));
    state.attachParcels(parcels);
    context.services().provide(ParcelBook.class, parcels);
    var base = System.getenv("FLIPT_URL");
    var environment = System.getenv("FLIPT_ENVIRONMENT");
    RentalGate gate;
    if (base == null || base.isBlank() || environment == null || environment.isBlank()) {
      gate = player -> CompletableFuture.completedFuture(false);
    } else {
      var remote = new FliptRentalGate(URI.create(base), environment);
      rentalGate = remote;
      gate = remote;
    }
    var rentals =
        new PlotRentals(
            parcels,
            leases,
            context.services().require(Wallets.class),
            new PlotRentals.Dependencies(
                context.time(), context.random(), context.scheduler().mainThread(), gate));
    context.services().provide(PlotRentals.class, rentals);
    var pending = await(leases.pending(), "plot payments");
    var _ =
        rentals
            .recover(pending)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (failure != null) {
                    context
                        .logger()
                        .error(
                            "Plot payments need reconciliation; affected plots remain frozen",
                            failure);
                  }
                },
                context.scheduler().mainThread());
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
    var recoveryStore = new JooqRecoveryStore(context.database());
    // Schematic and item archive encoding is CPU work for core's bounded pool, which closes
    // with the plugin.
    var archiveExecutor = context.compute().executor();
    var installed =
        TownsPaper.install(
            context,
            new TownsPaper.Loaded(settling, locks, pvp),
            config,
            new TownsPaper.Plots(
                parcels,
                rentals,
                recoveryStore,
                lockStore,
                await(recoveryStore.baselines(), "plot baselines"),
                await(recoveryStore.unfinished(), "plot recoveries"),
                context.loadConfig(
                    "plot-reconcile.json",
                    com.shepherdjerred.thestorm.towns.domain.parcel.PlotProtocol.class),
                archiveExecutor));
    context.services().provide(Protection.class, installed.protection());
    context.services().provide(SettledLand.class, installed.settled());
    context.services().provide(TownRead.class, new TownListings(state));
    context
        .services()
        .provide(
            com.shepherdjerred.thestorm.towns.app.LandRead.class,
            (world, x, y, z) ->
                state.landAt(world, x, y, z)
                    instanceof com.shepherdjerred.thestorm.towns.domain.land.Land.Wilderness);
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
    var gate = rentalGate;
    if (gate != null) {
      gate.close();
      rentalGate = null;
    }
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
