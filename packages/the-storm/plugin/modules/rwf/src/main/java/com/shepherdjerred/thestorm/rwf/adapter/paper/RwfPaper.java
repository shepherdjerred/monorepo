package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.snapshot.SnapshotStore;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.rwf.adapter.content.RwfContent;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.PayoutService;
import com.shepherdjerred.thestorm.rwf.app.Pseudonyms;
import com.shepherdjerred.thestorm.rwf.app.Recorder;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.bukkit.GameRules;
import org.bukkit.World;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;

/**
 * Wires Search and Destroy into Paper: the sealed world and its game rules, the maps, the runner,
 * listeners, commands, permissions and the 20 Hz clock. Admission opens once every map is pasted
 * and verified.
 */
public final class RwfPaper {

  private static final Duration TICK = Duration.ofMillis(50);

  private final PaperContext context;
  private final MatchRunner runner;
  private final Watchers watchers;
  private final PaperCombatantActions actions;
  private final List<MapWorld> maps;
  private final List<Listener> listeners;
  private final Cancellable clock;
  private final RwfPermissions permissions;
  private final SealedWorlds sealed;

  private RwfPaper(Parts parts) {
    this.context = parts.context();
    this.runner = parts.runner();
    this.watchers = parts.watchers();
    this.actions = parts.actions();
    this.maps = parts.maps();
    this.listeners = parts.listeners();
    this.clock = parts.clock();
    this.permissions = parts.permissions();
    this.sealed = parts.sealed();
  }

  private record Parts(
      PaperContext context,
      MatchRunner runner,
      Watchers watchers,
      PaperCombatantActions actions,
      List<MapWorld> maps,
      List<Listener> listeners,
      Cancellable clock,
      RwfPermissions permissions,
      SealedWorlds sealed) {}

  /**
   * The ports the adapters use.
   *
   * @param snapshots stored snapshots
   * @param store finished matches and the payout outbox
   * @param payouts the payout use case
   * @param recorder match recordings
   * @param pseudonyms the pseudonymiser; empty when recording is off
   * @param gate the managed rollout decision for joining
   * @param hooks the server operations tests replace
   */
  public record App(
      SnapshotStore snapshots,
      MatchStore store,
      PayoutService payouts,
      Recorder recorder,
      Optional<Pseudonyms> pseudonyms,
      JoinGate gate,
      ServerHooks hooks) {}

  /** Starts the module's Paper side. The configured world must be loaded already. */
  public static RwfPaper start(ModuleContext module, RwfContent content, App app) {
    var config = content.config();
    var world = module.plugin().getServer().getWorld(config.world());
    if (world == null) {
      throw new IllegalStateException(
          "rwf.yml names world "
              + config.world()
              + ", which is not loaded; provision it through Multiverse before enabling rwf");
    }
    var sealed = module.services().require(SealedWorlds.class);
    sealed.seal(world);
    gameRules(world);
    var context =
        new PaperContext(
            new PaperContext.Parts(
                module.plugin(),
                module.scheduler(),
                module.compute(),
                module.time(),
                module.random(),
                world));
    var keys = new Keys(module.plugin());
    var kits = KitFactory.build(keys, content.kits());
    var snapshots = new Snapshots(context, app.snapshots());
    var boards = new Scoreboards(context.server());
    var bombs = new BombMarkers(context, keys, app.hooks().hologramStyle());
    var maps = new ArrayList<MapWorld>();
    for (var map : content.maps()) {
      maps.add(new MapWorld(context, map, app.hooks().chunks()));
    }
    var bots = new Bots(module.services());
    var tracker = new CombatTracker();
    var recordings = new Recordings(app.recorder(), app.pseudonyms());
    var runner =
        new MatchRunner(
            new MatchRunner.Parts(
                context,
                config,
                snapshots,
                kits,
                boards,
                bombs,
                List.copyOf(maps),
                bots,
                tracker,
                app.payouts(),
                app.store(),
                recordings));
    var actions =
        new PaperCombatantActions(
            new PaperCombatantActions.Parts(runner, tracker, recordings, keys, app.hooks()));
    var watchers = new Watchers(runner, snapshots, boards, context);
    var _ = runner.subscribe(watchers::onTransition);
    var guard = new ItemGuard(runner, keys);
    List<Listener> listeners =
        List.of(
            new PlayerListener(
                new PlayerListener.Parts(
                    runner, snapshots, guard, actions, tracker, context, keys, bombs, watchers)),
            guard,
            new CombatListener(runner, tracker, context, app.hooks()),
            new WorldListener(runner, context, bombs));
    listeners.forEach(
        listener -> context.server().getPluginManager().registerEvents(listener, module.plugin()));
    var commands =
        new RwfCommands(
            new RwfCommands.Parts(context, runner, watchers, kits, app.gate(), config, bots));
    module
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
    var permissions = new RwfPermissions(context.server().getPluginManager());
    permissions.register();
    var clock = module.scheduler().repeatOnMainThread(TICK, TICK, runner::tick);
    bombs.cleanUp();
    var started =
        new RwfPaper(
            new Parts(
                context,
                runner,
                watchers,
                actions,
                List.copyOf(maps),
                listeners,
                clock,
                permissions,
                sealed));
    snapshots.load(player -> runner.memberOf(player).isPresent(), () -> {});
    started.prepareMaps();
    return started;
  }

  /** The rules of a sealed match world. */
  static void gameRules(World world) {
    world.setGameRule(GameRules.SPAWN_MOBS, false);
    world.setGameRule(GameRules.FIRE_SPREAD_RADIUS_AROUND_PLAYER, 0);
    world.setGameRule(GameRules.ADVANCE_TIME, false);
    world.setGameRule(GameRules.ADVANCE_WEATHER, false);
    world.setGameRule(GameRules.SHOW_DEATH_MESSAGES, false);
    world.setGameRule(GameRules.IMMEDIATE_RESPAWN, true);
    world.setGameRule(GameRules.SHOW_ADVANCEMENT_MESSAGES, false);
    world.setGameRule(GameRules.KEEP_INVENTORY, false);
    world.setGameRule(GameRules.TNT_EXPLODES, false);
    world.setGameRule(GameRules.NATURAL_HEALTH_REGENERATION, true);
  }

  /** Pastes or verifies every map in turn, then opens the lobby on the first. */
  private void prepareMaps() {
    prepare(0);
  }

  private void prepare(int index) {
    if (index >= maps.size()) {
      context.logger().info("rwf: {} maps ready; the lobby is open", maps.size());
      runner.open(maps.getFirst());
      return;
    }
    var map = maps.get(index);
    map.prepare(
        ok -> {
          if (!ok) {
            context
                .logger()
                .error("rwf: map {} could not be prepared; admission stays closed", map.map().id());
            return;
          }
          prepare(index + 1);
        });
  }

  public MatchView view() {
    return runner;
  }

  public MatchEvents events() {
    return runner;
  }

  public CombatantActions actions() {
    return actions;
  }

  /**
   * Stops the match (restoring everyone inside and every watcher), the clock, listeners and
   * permissions.
   */
  public void stop() {
    watchers.stop();
    runner.stop();
    clock.cancel();
    listeners.forEach(HandlerList::unregisterAll);
    permissions.unregister();
    maps.forEach(MapWorld::release);
    sealed.unseal(context.world().getName());
  }
}
