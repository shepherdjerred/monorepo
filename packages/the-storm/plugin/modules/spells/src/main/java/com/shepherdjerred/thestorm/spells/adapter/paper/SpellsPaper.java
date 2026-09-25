package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.spells.adapter.paper.spell.Spells;
import com.shepherdjerred.thestorm.spells.adapter.paper.spell.Toolbox;
import com.shepherdjerred.thestorm.spells.app.SpellScrolls;
import com.shepherdjerred.thestorm.spells.app.SpellStore;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellsConfig;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.Set;
import org.bukkit.Server;
import org.bukkit.entity.EntityType;

/** Hooks spells into Paper: items, listeners, the ticker and {@code /spells}. */
public final class SpellsPaper {

  private static final Duration TICK = Duration.ofMillis(250);

  private final SpellItems items;
  private final TemporaryBlocks blocks;
  private final SpellState state;
  private final Server server;
  private final Cancellable ticker;

  private SpellsPaper(Toolbox tools, SpellItems items, Cancellable ticker) {
    this.items = items;
    this.blocks = tools.blocks();
    this.state = tools.state();
    this.server = tools.server();
    this.ticker = ticker;
  }

  /**
   * Validates {@code config}'s Paper names, wires everything and starts loading stored state.
   *
   * @throws IllegalStateException listing every unknown material, particle, sound, entity or model
   */
  public static SpellsPaper install(
      ModuleContext context, SpellsConfig config, SpellStore store, Protection protection) {
    var problems = PaperNames.problems(config);
    if (!problems.isEmpty()) {
      throw new IllegalStateException("Invalid spells.yml:\n" + String.join("\n", problems));
    }
    var server = context.plugin().getServer();
    var async = new Async(context.scheduler(), context.logger());
    var state = new SpellState();
    var guard = new Guard(protection);
    var say = new Say(config.label());
    var waypoints = new Waypoints(store, async);
    var targets = new Targets(immune(config));
    var harm = new Harm(guard, state, context.time());
    var tools =
        new Toolbox(
            targets,
            guard,
            harm,
            new Teleports(guard),
            new TemporaryBlocks(store, server, context.time(), async),
            state,
            waypoints,
            fx(config),
            say,
            server,
            context.time(),
            context.random());
    var items = new SpellItems(context.plugin(), config);
    var flow = new CastFlow(Spells.create(config.spells(), tools), config.spells(), tools);
    var binder = new Binder(items, state, config.spells(), new Binder.Storage(store, async));
    var plugins = server.getPluginManager();
    plugins.registerEvents(new CastListener(items, state, flow, say), context.plugin());
    plugins.registerEvents(harm, context.plugin());
    plugins.registerEvents(
        new SpellEffectsListener(state, context.time(), targets), context.plugin());
    plugins.registerEvents(new TemporaryBlockGuard(tools.blocks()), context.plugin());
    plugins.registerEvents(new WorldSaveListener(tools.blocks()), context.plugin());
    plugins.registerEvents(new CraftingGuard(items), context.plugin());
    var command = new SpellsCommand(config, items, binder, say);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> command.register(event.registrar()));
    var ticker = new SpellTicker(tools);
    var repeating = context.scheduler().repeatOnMainThread(TICK, TICK, ticker::tick);
    load(store, tools, async);
    return new SpellsPaper(tools, items, repeating);
  }

  /** Reverts leftovers, then loads Marks and binds; casting opens once all three are done. */
  private static void load(SpellStore store, Toolbox tools, Async async) {
    tools
        .blocks()
        .recover(
            () ->
                async.onMain(
                    store.marks(),
                    "loading Marks",
                    marks -> {
                      tools.waypoints().restore(marks);
                      async.onMain(
                          store.foci(),
                          "loading focus binds",
                          foci -> {
                            tools.state().foci().restore(foci);
                            tools.state().markReady();
                          });
                    }));
  }

  private static Set<EntityType> immune(SpellsConfig config) {
    var immune = new HashSet<EntityType>();
    for (var name : config.immuneEntities()) {
      immune.add(
          PaperNames.entityType(name)
              .orElseThrow(() -> new IllegalStateException("immune entity " + name)));
    }
    return immune;
  }

  private static Fx fx(SpellsConfig config) {
    var resolved = new EnumMap<SpellKind, Fx.Resolved>(SpellKind.class);
    config
        .spells()
        .all()
        .forEach(
            (kind, entry) ->
                resolved.put(
                    kind,
                    new Fx.Resolved(
                        PaperNames.particle(entry.fx().particle()).orElseThrow(),
                        PaperNames.sound(entry.fx().sound()).orElseThrow())));
    return new Fx(resolved);
  }

  /** The scroll port other modules use. */
  public SpellScrolls scrolls() {
    return items;
  }

  /** Stops the ticker, reverts every temporary block and resets shifted skies. */
  public void stop() {
    ticker.cancel();
    blocks.revertAll();
    for (var player : state.timeShifts().keys()) {
      var online = server.getPlayer(player);
      if (online != null) {
        online.resetPlayerTime();
      }
    }
  }
}
