package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.arena.app.RewardPayer;
import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore;
import com.shepherdjerred.thestorm.arena.app.store.RewardStore;
import com.shepherdjerred.thestorm.arena.app.store.SnapshotStore;
import com.shepherdjerred.thestorm.arena.domain.arena.ArenaBundle;
import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.arena.domain.game.ArenaGame;
import com.shepherdjerred.thestorm.arena.domain.game.Setup;
import com.shepherdjerred.thestorm.arena.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.arena.domain.reward.LootEntry;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;

/** Wires the arenas into Paper: runners, commands, listeners, permissions and the game clock. */
public final class ArenaPaper {

  private static final Duration TICK = Duration.ofSeconds(1);

  private final Arenas arenas;
  private final List<Listener> listeners;
  private final Cancellable clock;
  private final ArenaPermissions permissions;

  private ArenaPaper(
      Arenas arenas, List<Listener> listeners, Cancellable clock, ArenaPermissions permissions) {
    this.arenas = arenas;
    this.listeners = List.copyOf(listeners);
    this.clock = clock;
    this.permissions = permissions;
  }

  /**
   * The ports and services the adapters use.
   *
   * @param snapshots stored snapshots
   * @param rewards vault claims and waiting loot
   * @param leaderboard best waves
   * @param payer pays wave rewards
   * @param formatter formats crystal amounts
   */
  public record App(
      SnapshotStore snapshots,
      RewardStore rewards,
      LeaderboardStore leaderboard,
      RewardPayer payer,
      CrystalFormatter formatter) {}

  /**
   * Starts every arena. Throws, naming every problem, if an arena's world is not loaded, a loot
   * chest is not a container, or content names an item, mob or effect the server does not know.
   */
  public static ArenaPaper start(
      ModuleContext module, ArenaBundle content, App app, ChunkKeeper chunks) {
    var context =
        new PaperContext(module.plugin(), module.scheduler(), module.time(), module.random());
    var keys = new Keys(module.plugin());
    var settings = content.settings();
    var texts = new Texts(settings.messages());
    var items = ItemFactory.build(keys, specs(content));
    var effects =
        ItemFactory.unknownEffects(
            content.classes().classes().values().stream()
                .flatMap(c -> c.effects().keySet().stream())
                .toList());
    if (!effects.isEmpty()) {
      throw new IllegalStateException("Unknown effects in arena/classes.yml: " + effects);
    }
    var mobs = MobFactory.create(keys, content.waves());
    var snapshots = new Snapshots(context, app.snapshots(), app.rewards(), texts);
    var services =
        new GameRunner.Services(
            context,
            snapshots,
            items,
            content.classes(),
            texts,
            app.payer(),
            app.formatter(),
            app.leaderboard(),
            app.rewards(),
            settings.rewards().vault());
    var problems = new ArrayList<String>();
    var runners = new ArrayList<GameRunner>();
    for (var definition : content.arenas()) {
      var world = context.server().getWorld(definition.world());
      if (world == null) {
        problems.add(
            "arena "
                + definition.id()
                + " is in world "
                + definition.world()
                + ", which is not loaded");
        continue;
      }
      var chests = new LootChests(world, definition.lootChests(), settings.lootChests(), items);
      problems.addAll(
          chests.problems().stream().map(p -> "arena " + definition.id() + ": " + p).toList());
      var parts =
          new ArenaWorld.Parts(
              context,
              keys,
              mobs,
              chests,
              chunks,
              content.waves(),
              settings.tier(definition.tier()),
              settings.waves().entityCap());
      runners.add(
          new GameRunner(
              new ArenaWorld(definition, world, parts),
              services,
              ArenaGame.open(setup(content, definition))));
    }
    if (!problems.isEmpty()) {
      throw new IllegalStateException("Invalid arenas: " + String.join("; ", problems));
    }
    runners.forEach(runner -> runner.world().cleanUp());

    var arenas = new Arenas(runners, snapshots);
    context.presence(arenas);
    var commands = new ArenaCommands(context, arenas, content.classes(), app.leaderboard());
    module
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
    var permissions = new ArenaPermissions(context.server().getPluginManager());
    permissions.register(content.classes());
    List<Listener> listeners =
        List.of(
            new PlayerListener(context, arenas, commands, keys), new WorldListener(arenas, keys));
    listeners.forEach(
        listener -> context.server().getPluginManager().registerEvents(listener, module.plugin()));
    var clock = module.scheduler().repeatOnMainThread(TICK, TICK, arenas::tick);
    snapshots.load(player -> arenas.arenaOf(player).isPresent());
    return new ArenaPaper(arenas, listeners, clock, permissions);
  }

  private static Setup setup(ArenaBundle content, ArenaDefinition definition) {
    var settings = content.settings();
    Map<String, String> names = new TreeMap<>();
    content.classes().classes().forEach((id, arenaClass) -> names.put(id, arenaClass.name()));
    return new Setup(
        definition.id(),
        definition.name(),
        definition.minPlayers(),
        definition.maxPlayers(),
        definition.playerSpawns().size(),
        settings.countdown(),
        settings.waves(),
        content.waves(),
        settings.tier(definition.tier()),
        settings.scaling(),
        settings.rewards(),
        names);
  }

  /** Every item the arena can hand out: kits, upgrades, loot chests and vaults. */
  private static List<ItemSpec> specs(ArenaBundle content) {
    var specs = new ArrayList<ItemSpec>();
    for (var arenaClass : content.classes().classes().values()) {
      specs.addAll(arenaClass.items());
      specs.addAll(arenaClass.upgrade());
    }
    content.settings().lootChests().entries().stream().map(LootEntry::item).forEach(specs::add);
    for (var milestone : content.settings().rewards().vault().milestones()) {
      milestone.loot().entries().stream().map(LootEntry::item).forEach(specs::add);
    }
    return specs;
  }

  /** Who is in which arena, for other modules. */
  public ArenaPresence presence() {
    return arenas;
  }

  /** Stops every game (restoring everyone inside), the clock, listeners and permissions. */
  public void stop() {
    arenas.stopAll();
    clock.cancel();
    listeners.forEach(HandlerList::unregisterAll);
    permissions.unregister();
  }
}
