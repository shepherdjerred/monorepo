package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.protection.SettledLand;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.towns.app.LockService;
import com.shepherdjerred.thestorm.towns.app.LocksStore;
import com.shepherdjerred.thestorm.towns.app.MembershipService;
import com.shepherdjerred.thestorm.towns.app.ParcelBook;
import com.shepherdjerred.thestorm.towns.app.PlotRentals;
import com.shepherdjerred.thestorm.towns.app.PvpService;
import com.shepherdjerred.thestorm.towns.app.RecoveryStore;
import com.shepherdjerred.thestorm.towns.app.Settling;
import com.shepherdjerred.thestorm.towns.app.TownService;
import com.shepherdjerred.thestorm.towns.app.Treasury;
import com.shepherdjerred.thestorm.towns.domain.TownsConfig;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelsConfig;
import com.shepherdjerred.thestorm.towns.domain.claiming.Claiming;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAccess;
import com.shepherdjerred.thestorm.towns.domain.parcel.PlotRecovery;
import com.shepherdjerred.thestorm.towns.domain.protection.DenialThrottle;
import com.shepherdjerred.thestorm.towns.domain.protection.ProtectionEngine;
import com.shepherdjerred.thestorm.towns.domain.world.Neighbourhood;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.HashMap;
import java.util.List;
import java.util.TreeSet;
import java.util.concurrent.Executor;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.event.Listener;

/**
 * Hooks towns into Paper: builds the use cases, registers every protection and lock listener and
 * the commands, and returns the {@link Protection} port for other modules. It needs the economy's
 * {@link Wallets} and {@link CrystalFormatter}, the tracks' {@link TrackLevels} and core's {@link
 * PlayerDirectory}.
 */
public final class TownsPaper {

  private TownsPaper() {}

  /**
   * What towns loaded before Paper is involved.
   *
   * @param settling the towns and their storage
   * @param locks every lock and its storage
   * @param pvp players' own PvP switches
   */
  public record Loaded(Settling settling, LockService locks, PvpService pvp) {}

  /** The protection and settled-land ports published for other modules. */
  public record Installed(Protection protection, SettledLand settled) {}

  public record Plots(
      ParcelBook book,
      PlotRentals rentals,
      RecoveryStore store,
      LocksStore locks,
      List<RecoveryStore.Baseline> baselines,
      List<PlotRecovery> unfinished,
      com.shepherdjerred.thestorm.towns.domain.parcel.PlotProtocol protocol,
      Executor archives) {}

  public static Installed install(
      ModuleContext context, Loaded loaded, TownsConfig config, Plots plots) {
    var server = context.plugin().getServer();
    requireWorlds(server, config);
    SpawnListener.requireSpawnReasons(config);
    var services = context.services();
    var levels = new GovernorLevels(server, services.require(TrackLevels.class));
    var names = new Names(server, services.require(PlayerDirectory.class), context.scheduler());
    var state = loaded.settling().state();
    var claiming = new Claiming(config.claims());
    var towns = new TownService(loaded.settling(), claiming, levels);
    var members =
        new MembershipService(
            loaded.settling(),
            config.membership(),
            new MembershipService.Hooks(
                levels,
                claiming.limits(),
                (townId, player, lockIds) -> {
                  var owner = state.town(townId).orElseThrow().owner();
                  loaded.locks().applyCommittedHandover(lockIds, player, owner);
                },
                loaded.locks()::isSettling));
    var treasury = new Treasury(towns, members, services.require(Wallets.class));
    var _ =
        treasury
            .recoverPayouts()
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (failure != null) {
                    context
                        .logger()
                        .error("A deleted town still has a pending treasury payout", failure);
                  }
                },
                context.scheduler().mainThread());
    var engine = new ProtectionEngine(state, loaded.pvp());
    var notices =
        new Notices(
            state,
            new DenialThrottle(config.denialCooldownMillis()),
            context.time(),
            context.scheduler());
    var plugin = context.plugin();
    var culprits =
        new Culprits(
            new Culprits.Keys(
                new NamespacedKey(plugin, "wither_builder"),
                new NamespacedKey(plugin, "cloud_thrower"),
                new NamespacedKey(plugin, "cloud_origin")),
            config.grief().thrownItemMemoryTicks());
    var guard = new Guard(state, engine, notices, culprits);
    var baselines = new HashMap<String, RecoveryStore.Baseline>();
    for (var baseline : plots.baselines()) {
      var definition =
          plots
              .book()
              .byId(baseline.parcelId())
              .orElseThrow(
                  () ->
                      new IllegalStateException(
                          "stored baseline has no configured plot " + baseline.parcelId()));
      if (!baseline
          .definitionHash()
          .equals(
              com.shepherdjerred.thestorm.towns.domain.parcel.ParcelFingerprint.of(definition))) {
        throw new IllegalStateException(
            "configured plot geometry changed for " + baseline.parcelId());
      }
      baselines.put(baseline.parcelId(), baseline);
      plots.book().baselineReady(baseline.parcelId());
    }
    var parts =
        new PlotParts(
            context,
            state,
            plots.book(),
            plots.rentals(),
            loaded.locks(),
            loaded.locks().book(),
            plots.locks(),
            plots.store(),
            baselines,
            plots.protocol(),
            plots.archives(),
            new PlotWorld(context));
    var mail = services.require(com.shepherdjerred.thestorm.mail.app.Mail.class);
    var packed = new PackedShops(parts, mail, guard);
    reservePlacements(plots, packed);
    var resetting = new PlotResetting(parts, mail, packed);
    var plotCommands = new PlotCommands(parts, plots.rentals(), packed, resetting);
    server.getPluginManager().registerEvents(packed, context.plugin());
    context
        .scheduler()
        .runOnMainThreadLater(
            java.time.Duration.ofMillis(50),
            () -> {
              var _ =
                  resetting
                      .reconcile()
                      .whenCompleteAsync(
                          (result, failure) -> {
                            if (failure != null) {
                              context
                                  .logger()
                                  .error(
                                      "Startup plot recovery failed; pending journals remain protected",
                                      failure);
                            }
                          },
                          context.scheduler().mainThread());
            });
    services.provide(
        com.shepherdjerred.thestorm.core.protection.ManagedTrades.class,
        location -> {
          var land = guard.land(location);
          return !(land instanceof com.shepherdjerred.thestorm.towns.domain.land.Land.WorkLand)
              && (!(land
                      instanceof
                      com.shepherdjerred.thestorm.towns.domain.land.Land.ParcelLand(var parcel))
                  || parcel.phase()
                      == com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel.Phase
                          .ACTIVE);
        });
    var kinds = new BlockKinds();
    var locks =
        new LockGuard(
            new LockGuard.Parts(
                loaded.locks().book(), new LockAccess(state), kinds, notices, state));
    var placers = new Placers(new NamespacedKey(plugin, "placed_by"));
    var runtime = new TownCommands.Services(context.scheduler(), context.logger());
    var memberCommands = new MemberCommands(members, towns, names, runtime);
    List<Listener> listeners =
        List.of(
            new SpawnRegions(server, state, config),
            new BlockListener(guard, kinds),
            new InteractListener(guard, kinds, locks),
            new EntityListener(guard),
            new CombatListener(guard, loaded.pvp()),
            new MovementListener(guard, kinds),
            new WorldListener(guard, kinds),
            new ParcelInventoryListener(guard),
            new FireListener(guard, kinds),
            new MobListener(
                guard, kinds, new Neighbourhood(state, state), config.grief().raidRadiusChunks()),
            new WitherListener(state, culprits, config.grief().witherBufferChunks(), server),
            new ContactListener(guard, server),
            new ArrivalListener(guard),
            new SpawnListener(guard),
            new LockListener(
                locks,
                loaded.locks(),
                kinds,
                new LockListener.PlacementTools(placers, context.random())),
            new JoinListener(towns, levels, memberCommands));
    for (var listener : listeners) {
      server.getPluginManager().registerEvents(listener, plugin);
    }
    var townCommands =
        new TownCommands(
            towns,
            state,
            new TownCommands.Parts(
                memberCommands,
                new TreasuryCommands(
                    treasury, services.require(CrystalFormatter.class), context.logger()),
                treasury,
                levels,
                runtime));
    var lockCommands =
        new LockCommands(
            loaded.locks(), locks, new LockCommands.Parts(guard, kinds, placers, names, runtime));
    var pvpCommands = new PvpCommands(loaded.pvp(), runtime);
    var regionCommands = new RegionCommands(state);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> {
              townCommands.register(event.registrar());
              lockCommands.register(event.registrar());
              pvpCommands.register(event.registrar());
              regionCommands.register(event.registrar());
              plotCommands.register(event.registrar());
            });
    return new Installed(
        new PaperProtection(server, guard, locks, new PaperProtection.Rendering(kinds, notices)),
        new PaperSettledLand(state));
  }

  /**
   * Every world {@code towns.yml} names must be loaded: a misspelt world would leave its claims or
   * regions silently unprotected.
   */
  public static void requireWorlds(Server server, TownsConfig config, ParcelsConfig parcels) {
    var named = new TreeSet<String>(config.claims().worlds());
    config
        .regions()
        .forEach(region -> region.areas().all().forEach(area -> named.add(area.world())));
    parcels.parcels().forEach(parcel -> named.add(parcel.area().world()));
    var missing = named.stream().filter(world -> server.getWorld(world) == null).toList();
    if (!missing.isEmpty()) {
      throw new IllegalStateException(
          "towns.yml or parcels.yml names worlds the server has not loaded: "
              + String.join(", ", missing));
    }
  }

  public static void requireWorlds(Server server, TownsConfig config) {
    requireWorlds(server, config, new ParcelsConfig(List.of()));
  }

  private static void reservePlacements(Plots plots, PackedShops packed) {
    for (var recovery : plots.unfinished()) {
      if (recovery.state() == PlotRecovery.State.PLACING
          || recovery.state() == PlotRecovery.State.ROLLING_BACK) {
        packed.reserve(recovery.id(), recovery.destination().orElseThrow());
      }
    }
  }
}
