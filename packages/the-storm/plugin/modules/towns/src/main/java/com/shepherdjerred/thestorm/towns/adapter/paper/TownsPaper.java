package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.towns.app.TownService;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.TownsConfig;
import com.shepherdjerred.thestorm.towns.domain.protection.DenialThrottle;
import com.shepherdjerred.thestorm.towns.domain.protection.ProtectionEngine;
import com.shepherdjerred.thestorm.towns.domain.world.Neighbourhood;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.List;
import java.util.TreeSet;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.event.Listener;

/**
 * Hooks towns into Paper: registers every protection listener and the commands, and returns the
 * {@link Protection} port for other modules.
 */
public final class TownsPaper {

  private TownsPaper() {}

  public static Protection install(
      ModuleContext context, TownsState state, TownService towns, TownsConfig config) {
    var server = context.plugin().getServer();
    requireWorlds(server, config);
    var engine = new ProtectionEngine(state);
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
    List<Listener> listeners =
        List.of(
            new BlockListener(guard, kinds),
            new InteractListener(guard, kinds),
            new EntityListener(guard),
            new CombatListener(guard),
            new MovementListener(guard, kinds),
            new WorldListener(guard, kinds),
            new FireListener(guard, kinds),
            new MobListener(
                guard, kinds, new Neighbourhood(state, state), config.grief().raidRadiusChunks()),
            new WitherListener(state, culprits, config.grief().witherBufferChunks(), server),
            new ContactListener(guard, server),
            new ArrivalListener(guard));
    for (var listener : listeners) {
      server.getPluginManager().registerEvents(listener, context.plugin());
    }
    var townCommands =
        new TownCommands(
            towns, state, new TownCommands.Services(context.scheduler(), context.logger()));
    var regionCommands = new RegionCommands(state.regions());
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> {
              townCommands.register(event.registrar());
              regionCommands.register(event.registrar());
            });
    return new PaperProtection(
        server, guard, engine, new PaperProtection.Rendering(kinds, notices));
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
