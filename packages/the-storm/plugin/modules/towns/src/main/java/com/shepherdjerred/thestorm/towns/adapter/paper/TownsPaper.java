package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.protection.SettledLand;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.towns.app.LockService;
import com.shepherdjerred.thestorm.towns.app.MembershipService;
import com.shepherdjerred.thestorm.towns.app.PvpService;
import com.shepherdjerred.thestorm.towns.app.Settling;
import com.shepherdjerred.thestorm.towns.app.TownService;
import com.shepherdjerred.thestorm.towns.app.Treasury;
import com.shepherdjerred.thestorm.towns.domain.TownsConfig;
import com.shepherdjerred.thestorm.towns.domain.claiming.Claiming;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAccess;
import com.shepherdjerred.thestorm.towns.domain.protection.DenialThrottle;
import com.shepherdjerred.thestorm.towns.domain.protection.ProtectionEngine;
import com.shepherdjerred.thestorm.towns.domain.world.Neighbourhood;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.List;
import java.util.TreeSet;
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

  public static Installed install(ModuleContext context, Loaded loaded, TownsConfig config) {
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
            new BlockListener(guard, kinds),
            new InteractListener(guard, kinds),
            new EntityListener(guard),
            new CombatListener(guard, loaded.pvp()),
            new MovementListener(guard, kinds),
            new WorldListener(guard, kinds),
            new FireListener(guard, kinds),
            new MobListener(
                guard, kinds, new Neighbourhood(state, state), config.grief().raidRadiusChunks()),
            new WitherListener(state, culprits, config.grief().witherBufferChunks(), server),
            new ContactListener(guard, server),
            new ArrivalListener(guard),
            new SpawnListener(guard),
            new LockListener(locks, loaded.locks(), kinds, placers),
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
    var regionCommands = new RegionCommands(state.regions());
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> {
              townCommands.register(event.registrar());
              lockCommands.register(event.registrar());
              pvpCommands.register(event.registrar());
              regionCommands.register(event.registrar());
            });
    return new Installed(
        new PaperProtection(server, guard, locks, new PaperProtection.Rendering(kinds, notices)),
        new PaperSettledLand(state));
  }

  /**
   * Every world {@code towns.yml} names must be loaded: a misspelt world would leave its claims or
   * regions silently unprotected.
   */
  static void requireWorlds(Server server, TownsConfig config) {
    var named = new TreeSet<String>(config.claims().worlds());
    config
        .regions()
        .forEach(region -> region.areas().all().forEach(area -> named.add(area.world())));
    var missing = named.stream().filter(world -> server.getWorld(world) == null).toList();
    if (!missing.isEmpty()) {
      throw new IllegalStateException(
          "towns.yml names worlds the server has not loaded: " + String.join(", ", missing));
    }
  }
}
