package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.arena.app.RewardPayer;
import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore;
import com.shepherdjerred.thestorm.arena.app.store.RewardStore;
import com.shepherdjerred.thestorm.arena.app.store.SurvivalProgress;
import com.shepherdjerred.thestorm.arena.domain.arena.ArenaBundle;
import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.arena.domain.game.ArenaGame;
import com.shepherdjerred.thestorm.arena.domain.game.Setup;
import com.shepherdjerred.thestorm.arena.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.arena.domain.reward.LootEntry;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.snapshot.SnapshotStore;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;

/** Wires the arenas into Paper: runners, commands, listeners, permissions and the game clock. */
public final class ArenaPaper {

  private static final Duration TICK = Duration.ofSeconds(1);

  private final Arenas arenas;
  private final List<Listener> listeners;
  private final Cancellable clock;
  private final ArenaPermissions permissions;
  private final List<ArenaRunner> runners;
  private final SettlementProvisioner provisioner;
  private boolean stopped;

  private ArenaPaper(
      Arenas arenas,
      List<ArenaRunner> runners,
      List<Listener> listeners,
      Cancellable clock,
      ArenaPermissions permissions,
      SettlementProvisioner provisioner) {
    this.arenas = arenas;
    this.runners = List.copyOf(runners);
    this.listeners = List.copyOf(listeners);
    this.clock = clock;
    this.permissions = permissions;
    this.provisioner = provisioner;
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
      CrystalFormatter formatter,
      SurvivalProgress survivalProgress,
      com.shepherdjerred.thestorm.arena.app.SurvivalGate survivalGate,
      com.shepherdjerred.thestorm.arena.app.store.SettlementStore settlementStore) {}

  /**
   * Starts every arena. Missing worlds and unknown content fail immediately; chest blocks are
   * checked after their chunks load asynchronously, with admissions closed until cleanup finishes.
   */
  public record Content(ArenaBundle colosseum, SurvivalContent survival) {}

  public static ArenaPaper start(ModuleContext module, Content data, App app, ServerHooks hooks) {
    var content = data.colosseum();
    var survival = data.survival();
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
    var snapshots =
        new Snapshots(context, new Snapshots.Parts(app.snapshots(), app.rewards(), texts));
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
    var runners = new ArrayList<ArenaRunner>();
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
      var parts =
          new ArenaWorld.Parts(
              context,
              keys,
              mobs,
              chests,
              hooks.chunks(),
              content.waves(),
              settings.tier(definition.tier()),
              settings.waves().entityCap());
      runners.add(
          new GameRunner(
              new ArenaWorld(definition, world, parts),
              services,
              ArenaGame.open(setup(content, definition))));
    }
    SurvivalItems.validate(survival);
    if (survival.enabled()) {
      var definition = survival.arena();
      var world = context.server().getWorld(definition.world());
      if (world == null) {
        throw new IllegalStateException("Missing survival world " + definition.world());
      }
      var chests = new LootChests(world, List.of(), settings.lootChests(), items);
      var parts =
          new ArenaWorld.Parts(
              context,
              keys,
              mobs,
              chests,
              hooks.chunks(),
              content.waves(),
              settings.tier(1),
              survival.entityCap());
      runners.add(
          new SurvivalRunner(
              new ArenaWorld(definition, world, parts),
              survival,
              new SurvivalRunner.Services(
                  context,
                  snapshots,
                  keys,
                  content.waves(),
                  app.survivalProgress(),
                  app.leaderboard(),
                  app.survivalGate())));
    }
    if (!problems.isEmpty()) {
      throw new IllegalStateException("Invalid arenas: " + String.join("; ", problems));
    }
    var arenas = new Arenas(runners, snapshots);
    var provisioner =
        new SettlementProvisioner(
            context,
            survival,
            new SettlementProvisioner.Ports(
                app.settlementStore(), module.services(), hooks.chunks()));
    context.presence(arenas);
    var commands = new ArenaCommands(context, arenas, content.classes(), app.leaderboard());
    module
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
    module
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> new SurvivalCommands(arenas).register(event.registrar()));
    module
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> SettlementCommands.register(event.registrar(), provisioner));
    var permissions = new ArenaPermissions(context.server().getPluginManager());
    permissions.register(content.classes());
    var guard = new ItemGuard(arenas, keys);
    List<Listener> listeners =
        List.of(
            new PlayerListener(context, arenas, commands, guard),
            guard,
            new WorldListener(arenas, keys),
            new SurvivalListener(arenas));
    listeners.forEach(
        listener -> context.server().getPluginManager().registerEvents(listener, module.plugin()));
    var clock = module.scheduler().repeatOnMainThread(TICK, TICK, arenas::tick);
    snapshots.load(player -> arenas.arenaOf(player).isPresent());
    var started = new ArenaPaper(arenas, runners, listeners, clock, permissions, provisioner);
    started.prepare(context);
    return started;
  }

  private void prepare(PaperContext context) {
    var loads =
        runners.stream()
            .map(runner -> runner.world().startupPreload())
            .toArray(CompletableFuture[]::new);
    var _ =
        CompletableFuture.allOf(loads)
            .thenComposeAsync(
                _ ->
                    CompletableFuture.allOf(
                        runners.stream()
                            .map(ArenaRunner::prepareStartup)
                            .toArray(CompletableFuture[]::new)),
                context.mainThread())
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (stopped) {
                    return;
                  }
                  try {
                    if (failure != null) {
                      throw new IllegalStateException("Could not load arena chunks", failure);
                    }
                    var problems = new ArrayList<String>();
                    for (var runner : runners) {
                      problems.addAll(
                          runner.world().chestProblems().stream()
                              .map(problem -> "arena " + runner.id() + ": " + problem)
                              .toList());
                    }
                    if (!problems.isEmpty()) {
                      throw new IllegalStateException(
                          "Invalid arenas: " + String.join("; ", problems));
                    }
                    arenas.ready();
                    context.logger().info("Prepared arena maps; admission is open");
                  } catch (RuntimeException error) {
                    arenas.startupFailed();
                    context
                        .logger()
                        .error("Could not prepare arenas; admission is disabled", error);
                  } finally {
                    runners.forEach(runner -> runner.world().cancelPreload());
                  }
                },
                context.mainThread());
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
      specs.addAll(
          com.shepherdjerred.thestorm.arena.domain.kit.GearProgression.templates(arenaClass));
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
    stopped = true;
    provisioner.stop();
    runners.forEach(runner -> runner.world().cancelPreload());
    arenas.stopAll();
    clock.cancel();
    listeners.forEach(HandlerList::unregisterAll);
    permissions.unregister();
  }
}
