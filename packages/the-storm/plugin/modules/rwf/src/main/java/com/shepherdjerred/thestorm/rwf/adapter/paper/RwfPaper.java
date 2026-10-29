package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.snapshot.SavedPlayerData;
import com.shepherdjerred.thestorm.core.snapshot.SnapshotStore;
import com.shepherdjerred.thestorm.core.status.PublicGameDirectory;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.rwf.adapter.content.RwfCatalog;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.FeatureGates;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.PayoutService;
import com.shepherdjerred.thestorm.rwf.app.Pseudonyms;
import com.shepherdjerred.thestorm.rwf.app.Recorder;
import com.shepherdjerred.thestorm.rwf.app.RwfFeatures;
import com.shepherdjerred.thestorm.rwf.app.map.MapResourceRegistry;
import com.shepherdjerred.thestorm.rwf.app.shop.KitShop;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStats;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import com.shepherdjerred.thestorm.rwf.app.store.StatsStore;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.bukkit.GameRules;
import org.bukkit.World;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;

/**
 * Wires Search and Destroy into Paper: the sealed world and its game rules, the maps, the runner,
 * listeners, commands, permissions and the 20 Hz clock. Admission opens once the lobby and first
 * map are pasted and verified; at most one following map is prepared.
 */
public final class RwfPaper {

  private static final Duration TICK = Duration.ofMillis(50);

  public com.shepherdjerred.thestorm.rwf.app.map.MapLoading loading() {
    return () -> maps.stream().map(MapWorld::loadingState).toList();
  }

  public com.shepherdjerred.thestorm.rwf.app.ShowcaseControl showcases() {
    return new com.shepherdjerred.thestorm.rwf.app.ShowcaseControl() {
      @Override
      public Optional<String> prepare(java.util.UUID lobbyId) {
        return runner.prepareShowcase(lobbyId);
      }

      @Override
      public Optional<String> start(int combatants) {
        return runner.startShowcase(combatants);
      }

      @Override
      public Optional<String> startSeeded(java.util.UUID lobbyId, int combatants, long seed) {
        return runner.startSeededShowcase(lobbyId, combatants, seed);
      }

      @Override
      public Optional<String> stop(java.util.UUID matchId) {
        return runner.stopShowcase(matchId);
      }
    };
  }

  private final PaperContext context;
  private final MatchRunner runner;
  private final Watchers watchers;
  private final PaperCombatantActions actions;
  private final List<MapWorld> maps;
  private final LobbyRoom lobby;
  private final LobbyDisplays displays;
  private final com.shepherdjerred.thestorm.rwf.app.store.QuarantineStore quarantines;
  private final List<Listener> listeners;
  private final Cancellable clock;
  private final RwfPermissions permissions;
  private final SealedWorlds sealed;
  private final PublicGameDirectory publicGames;
  private final TeamChat teamChat;

  private RwfPaper(Parts parts) {
    this.context = parts.context();
    this.runner = parts.runner();
    this.watchers = parts.watchers();
    this.actions = parts.actions();
    this.maps = parts.maps();
    this.lobby = parts.lobby();
    this.displays = parts.displays();
    this.quarantines = parts.quarantines();
    this.listeners = parts.listeners();
    this.clock = parts.clock();
    this.publicGames = parts.publicGames();
    this.permissions = parts.permissions();
    this.sealed = parts.sealed();
    this.teamChat = parts.teamChat();
  }

  /** Notified on the main thread after a match's statistics are stored. */
  public void onSettled(Consumer<MatchStats> listener) {
    runner.onSettled(listener);
  }

  private record Parts(
      PaperContext context,
      MatchRunner runner,
      Watchers watchers,
      PaperCombatantActions actions,
      List<MapWorld> maps,
      LobbyRoom lobby,
      LobbyDisplays displays,
      List<Listener> listeners,
      Cancellable clock,
      RwfPermissions permissions,
      SealedWorlds sealed,
      PublicGameDirectory publicGames,
      TeamChat teamChat,
      com.shepherdjerred.thestorm.rwf.app.store.QuarantineStore quarantines) {}

  /**
   * The ports the adapters use.
   *
   * @param snapshots stored snapshots
   * @param store finished matches and the payout outbox
   * @param payouts the payout use case
   * @param recorder match recordings
   * @param pseudonyms the pseudonymiser; empty when recording is off
   * @param gate the managed rollout decision for joining
   * @param features the managed rollout decisions for kits and killstreaks
   * @param shop the kit shop
   * @param hooks the server operations tests replace
   * @param features the managed match feature flags
   * @param stats lifetime statistics, history and preferences
   * @param quarantines the maps an operator quarantined, kept across restarts
   */
  public record App(
      SnapshotStore snapshots,
      MatchStore store,
      PayoutService payouts,
      Recorder recorder,
      Optional<Pseudonyms> pseudonyms,
      JoinGate gate,
      FeatureGates kitGates,
      KitShop shop,
      ServerHooks hooks,
      RwfFeatures.Source features,
      StatsStore stats,
      com.shepherdjerred.thestorm.rwf.app.store.QuarantineStore quarantines,
      com.shepherdjerred.thestorm.rwf.app.store.StreakStore streaks) {}

  /** Starts the module's Paper side. The configured worlds must be loaded already. */
  public static RwfPaper start(
      ModuleContext module, RwfCatalog content, MapResourceRegistry resources, App app) {
    var battleSounds = new com.shepherdjerred.thestorm.rwf.app.BattleSoundLog(module.time());
    var tacticalReports = new com.shepherdjerred.thestorm.rwf.app.TacticalReportLog(module.time());
    module
        .services()
        .provide(com.shepherdjerred.thestorm.rwf.app.TacticalReports.class, tacticalReports);
    module.services().provide(com.shepherdjerred.thestorm.rwf.app.BattleSounds.class, battleSounds);
    var config = content.config();
    var lobbyWorld = loadedWorld(module, config.worlds().lobby());
    var mapWorld = loadedWorld(module, config.worlds().maps());
    var sealed = module.services().require(SealedWorlds.class);
    for (var world : List.of(lobbyWorld, mapWorld)) {
      sealed.seal(world);
      gameRules(world);
    }
    var context =
        new PaperContext(
            new PaperContext.Parts(
                module.plugin(),
                module.scheduler(),
                module.compute(),
                module.time(),
                module.random(),
                lobbyWorld,
                mapWorld,
                module
                    .services()
                    .require(com.shepherdjerred.thestorm.core.world.BlockChanges.class),
                module.analytics(),
                battleSounds,
                tacticalReports,
                module
                    .services()
                    .require(
                        com.shepherdjerred.thestorm.core.players.PlayerVisibilityControl.class),
                sealed));
    var keys = new Keys(module.plugin());
    var kits = KitFactory.build(keys, content.kits());
    var experiences = new com.shepherdjerred.thestorm.rwf.app.MatchExperiences(config.experience());
    var armory =
        new Armory(
            new Armory.Parts(
                context,
                app.shop(),
                app.kitGates().kits(),
                content.kits(),
                () ->
                    new com.shepherdjerred.thestorm.rwf.domain.kit.KitPool(
                        experiences.currentOrPending().kits())));
    // Kit picks, map votes and finished matches; the killstreaks and kit shop call its hooks.
    var productEvents = new RwfAnalytics(context.analytics());
    var menus = new KitMenus(context, kits, armory, productEvents);
    var snapshots =
        new Snapshots(context, app.snapshots(), module.services().require(SavedPlayerData.class));
    var boards = new Scoreboards(context.server());
    module
        .services()
        .provide(com.shepherdjerred.thestorm.rwf.app.NameTags.class, boards::hiddenFromEnemies);
    var bombs = new BombMarkers(context, keys, app.hooks().displayStyle());
    var maps = new ArrayList<MapWorld>();
    for (var map : content.rotation()) {
      maps.add(new MapWorld(context, map, app.hooks().chunks(), resources));
    }
    var statsHolder = new AtomicReference<Stats>();
    var featureHolder = new AtomicReference<MatchRunner>();
    var lobby = new LobbyRoom(context, content.lobby(), app.hooks().chunks());
    var displays =
        new LobbyDisplays(
            new LobbyDisplays.Parts(
                context,
                keys,
                lobby,
                kits,
                app.hooks().displayStyle(),
                () -> armory.anyExpanded() ? armory.rotation(context.time().instant()) : List.of(),
                () -> Optional.ofNullable(statsHolder.get()).map(Stats::leaders).orElseGet(Map::of),
                () ->
                    Optional.ofNullable(featureHolder.get())
                        .map(started -> started.features().stats())
                        .orElse(false)));
    var bots = new Bots(module.services());
    var tracker = new CombatTracker(context.time());
    var inputs = new Inputs();
    context
        .server()
        .getMessenger()
        .registerIncomingPluginChannel(
            module.plugin(),
            com.shepherdjerred.thestorm.rwf.domain.record.ControlPacket.CHANNEL,
            inputs);
    context
        .server()
        .getMessenger()
        .registerOutgoingPluginChannel(
            module.plugin(),
            com.shepherdjerred.thestorm.rwf.domain.record.ObservationPacket.CHANNEL);
    var recordings =
        new Recordings(
            new Recordings.Parts(
                app.recorder(), app.pseudonyms(), inputs, module.services(), module.plugin()));
    var runner =
        new MatchRunner(
            new MatchRunner.Parts(
                context,
                config,
                experiences,
                snapshots,
                kits,
                boards,
                bombs,
                List.copyOf(maps),
                bots,
                tracker,
                app.payouts(),
                app.store(),
                recordings,
                lobby,
                new LobbyHud(context.server(), boards::lobby),
                displays,
                menus,
                keys,
                app.features(),
                app.kitGates().killstreaks(),
                productEvents,
                app.streaks()));
    runner.powers().streaks().hooks(app.hooks(), battleSounds);
    module
        .services()
        .provide(
            com.shepherdjerred.thestorm.rwf.app.MatchSummons.class,
            runner.powers().streaks().summons());
    module
        .services()
        .provide(
            com.shepherdjerred.thestorm.rwf.app.VisualOcclusion.class, runner.powers().tactical());
    module
        .services()
        .provide(
            com.shepherdjerred.thestorm.rwf.app.TacticalCasting.class, runner.powers().tactical());
    var teleporterMenus = new TeleporterMenus(runner, context, kits);
    var kitClicks = new KitListener(runner, context, keys, teleporterMenus);
    var kitWorld = new KitWorldListener(runner, context, keys, app.hooks());
    var actions =
        new PaperCombatantActions(
            new PaperCombatantActions.Parts(
                runner,
                tracker,
                recordings,
                keys,
                app.hooks(),
                new BotKitUses(runner, kitClicks, kitWorld, teleporterMenus)));
    var watchers = new Watchers(runner, snapshots, boards, context);
    var _ = runner.subscribe(watchers::onTransition);
    var metrics = new MatchAnalytics(context.activity());
    var _ = runner.subscribe(metrics::accept);
    var _ = runner.subscribe(notification -> productEvents.accept(notification, runner.match()));
    var hats = new Hats(runner, context);
    var _ = runner.subscribe(hats::accept);
    var guard = new ItemGuard(runner, keys);
    var spectating = new Spectating(runner, watchers, keys, context);
    // The dead's star opens the layout editor for the kit they fought with, as the kit menu's
    // right-click does.
    spectating.kitLayouts(
        player ->
            runner
                .memberOf(player.getUniqueId())
                .flatMap(member -> member.kit())
                .flatMap(com.shepherdjerred.thestorm.rwf.domain.kit.KitBook::byId)
                .ifPresent(kit -> menus.editLayout(player, kit)));
    var teamChat =
        new TeamChat(
            new TeamChat.Parts(
                runner,
                watchers,
                app.stats(),
                context,
                line ->
                    runner
                        .memberOf(line.speaker())
                        .ifPresent(
                            member ->
                                recordings.chat(
                                    member.id(),
                                    MatchRunner.machineName(line.channel().name()),
                                    line.text()))));
    runner.tools(spectating, teamChat);
    bombs.effects(() -> runner.features().bombEffects());
    runner.onDeath(spectating::death);
    teamChat.register(
        module.services().find(com.shepherdjerred.thestorm.chat.app.ChannelRegistry.class));
    var stats = new Stats(runner, app.stats(), context);
    statsHolder.set(stats);
    // The leaderboards are read again as each lobby opens its vote, after the last match settled.
    var _ =
        runner.subscribe(
            notification -> {
              if (notification.event()
                      instanceof
                      com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.BallotOpened
                  && runner.features().stats()) {
                stats.refreshLeaders(() -> {});
              }
            });
    featureHolder.set(runner);
    List<Listener> listeners =
        List.of(
            new PlayerListener(
                new PlayerListener.Parts(
                    runner, snapshots, guard, actions, tracker, context, keys, bombs, watchers)),
            guard,
            new KitMenuListener(runner, context, menus),
            new StreakMenuListener(runner, context),
            new SettingsListener(runner, context),
            new KitLayoutListener(keys, menus.armory()),
            new CombatListener(runner, tracker, context, app.hooks()),
            new WorldListener(runner, context, bombs),
            new AfkWatch(runner),
            kitClicks,
            new ExpansionKitListener(runner, keys),
            new TacticalKitListener(runner, keys),
            kitWorld,
            new KillstreakListener(runner, context),
            new SacrificeListener(runner, context, tracker),
            teleporterMenus,
            spectating,
            hats,
            inputs);
    listeners.forEach(
        listener -> context.server().getPluginManager().registerEvents(listener, module.plugin()));
    var commands =
        new RwfCommands(
            new RwfCommands.Parts(
                context,
                runner,
                watchers,
                kits,
                menus,
                app.gate(),
                config,
                bots,
                stats,
                spectating,
                teamChat,
                app.quarantines()));
    module
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));
    var permissions = new RwfPermissions(context.server().getPluginManager());
    permissions.register();
    var publicGames = module.services().require(PublicGameDirectory.class);
    var clock =
        module
            .scheduler()
            .repeatOnMainThread(
                TICK,
                TICK,
                () -> {
                  runner.tick();
                  publicGames.replace(
                      PublicGameDirectory.Kind.RWF, runner.publicGame().stream().toList());
                });
    bombs.cleanUp();
    var started =
        new RwfPaper(
            new Parts(
                context,
                runner,
                watchers,
                actions,
                List.copyOf(maps),
                lobby,
                displays,
                listeners,
                clock,
                permissions,
                sealed,
                publicGames,
                teamChat,
                app.quarantines()));
    snapshots.load(player -> runner.memberOf(player).isPresent(), () -> {});
    started.prepareMaps();
    return started;
  }

  private static World loadedWorld(ModuleContext module, String name) {
    var world = module.plugin().getServer().getWorld(name);
    if (world == null) {
      throw new IllegalStateException(
          "rwf.yml names world "
              + name
              + ", which is not loaded; provision it through Multiverse before enabling rwf");
    }
    return world;
  }

  /** The rules of a sealed rwf world. */
  static void gameRules(World world) {
    world.setGameRule(GameRules.SPAWN_MOBS, false);
    world.setGameRule(GameRules.FIRE_SPREAD_RADIUS_AROUND_PLAYER, 0);
    world.setGameRule(GameRules.ADVANCE_TIME, false);
    world.setGameRule(GameRules.ADVANCE_WEATHER, false);
    world.setGameRule(GameRules.RANDOM_TICK_SPEED, 0);
    world.setGameRule(GameRules.SHOW_DEATH_MESSAGES, false);
    world.setGameRule(GameRules.IMMEDIATE_RESPAWN, true);
    world.setGameRule(GameRules.SHOW_ADVANCEMENT_MESSAGES, false);
    world.setGameRule(GameRules.KEEP_INVENTORY, false);
    world.setGameRule(GameRules.TNT_EXPLODES, false);
    world.setGameRule(GameRules.NATURAL_HEALTH_REGENERATION, true);
  }

  /** Prepares the lobby. The runner prepares each map the lobby votes for. */
  private void prepareMaps() {
    lobby.prepare(
        ok -> {
          if (!ok) {
            context.logger().error("rwf: the lobby could not be prepared; admission stays closed");
            return;
          }
          context.logger().info("rwf: the lobby is ready; {} maps in rotation", maps.size());
          // The operator's quarantines outlast a restart: they leave the rotation before the
          // first vote is offered.
          context.onMain(
              quarantines.all(),
              kept -> {
                kept.forEach(
                    (mapId, reason) -> {
                      if (runner.rotation().byId(mapId).isPresent()
                          && runner.rotation().playable().size() > 1) {
                        var _ = runner.rotation().quarantine(mapId);
                        context.logger().info("rwf: {} stays quarantined: {}", mapId, reason);
                      }
                    });
                displays.open();
                runner.open();
              },
              "read the quarantined rwf maps");
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
    teamChat.unregister();
    watchers.stop();
    runner.stop();
    context
        .visibility()
        .release(com.shepherdjerred.thestorm.core.players.PlayerVisibilityControl.Reason.COMBAT);
    context
        .visibility()
        .release(com.shepherdjerred.thestorm.core.players.PlayerVisibilityControl.Reason.SPECTATOR);
    clock.cancel();
    listeners.forEach(HandlerList::unregisterAll);
    context
        .server()
        .getMessenger()
        .unregisterIncomingPluginChannel(
            context.plugin(), com.shepherdjerred.thestorm.rwf.domain.record.ControlPacket.CHANNEL);
    context
        .server()
        .getMessenger()
        .unregisterOutgoingPluginChannel(
            context.plugin(),
            com.shepherdjerred.thestorm.rwf.domain.record.ObservationPacket.CHANNEL);
    permissions.unregister();
    maps.forEach(MapWorld::release);
    displays.clear();
    lobby.release();
    sealed.unseal(context.lobbyWorld().getName());
    sealed.unseal(context.mapWorld().getName());
    publicGames.replace(PublicGameDirectory.Kind.RWF, List.of());
  }
}
