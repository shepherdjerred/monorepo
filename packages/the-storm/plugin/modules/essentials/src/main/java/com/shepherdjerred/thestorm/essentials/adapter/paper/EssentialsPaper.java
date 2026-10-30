package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.adapter.files.SavedRespawn;
import com.shepherdjerred.thestorm.essentials.app.AfkTracker;
import com.shepherdjerred.thestorm.essentials.app.GuardRegistry;
import com.shepherdjerred.thestorm.essentials.app.HomeSignals;
import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import com.shepherdjerred.thestorm.essentials.app.PlayerDirectory;
import com.shepherdjerred.thestorm.essentials.app.TeleportPayments;
import com.shepherdjerred.thestorm.essentials.app.TpaDesk;
import com.shepherdjerred.thestorm.essentials.app.WarpDirectory;
import com.shepherdjerred.thestorm.essentials.app.store.BackStore;
import com.shepherdjerred.thestorm.essentials.app.store.HomeStore;
import com.shepherdjerred.thestorm.essentials.app.store.KitClaimStore;
import com.shepherdjerred.thestorm.essentials.domain.config.EssentialsConfig;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;

/** Wires essentials into Paper: commands, listeners, permissions and periodic checks. */
public final class EssentialsPaper {

  private static final Duration SWEEP_EVERY = Duration.ofSeconds(5);

  private final List<Listener> listeners;
  private final List<Cancellable> tasks;
  private final TeleportFlow flow;
  private final EssentialsPermissions permissions;
  private final StaffPaper staff;

  private EssentialsPaper(
      List<Listener> listeners,
      List<Cancellable> tasks,
      TeleportFlow flow,
      EssentialsPermissions permissions,
      StaffPaper staff) {
    this.listeners = List.copyOf(listeners);
    this.tasks = List.copyOf(tasks);
    this.flow = flow;
    this.permissions = permissions;
    this.staff = staff;
  }

  /**
   * The app-layer services the adapters use.
   *
   * @param payments teleport pricing and charging
   * @param guards teleport guards from other modules
   * @param afk away status
   * @param moderation kicks, bans and the audit log
   * @param players last-known player names
   * @param warps server warps
   * @param stores storage the commands read and write directly
   * @param protection land protection from the towns module
   */
  public record App(
      TeleportPayments payments,
      GuardRegistry guards,
      AfkTracker afk,
      ModerationService moderation,
      PlayerDirectory players,
      WarpDirectory warps,
      Stores stores,
      Protection protection,
      SealedWorlds sealed,
      CompletableFuture<SavedRespawn.Scan> savedRespawns) {}

  /**
   * Storage used directly by commands and listeners.
   *
   * @param homes players' homes
   * @param back {@code /back} history
   * @param kitClaims kit claims
   */
  public record Stores(HomeStore homes, BackStore back, KitClaimStore kitClaims) {}

  /**
   * Registers everything. Throws if the configured kits name unknown items or enchantments, or the
   * spawn is unsafe. An unloaded existing spawn is checked asynchronously with logins held closed.
   */
  public static EssentialsPaper start(
      ModuleContext context, EssentialsConfig config, App app, HomeSignals homes) {
    var server = context.plugin().getServer();
    var runtime =
        new PaperRuntime(
            server, context.scheduler(), context.time(), context.logger(), context.analytics());
    var maintenance = new MaintenanceCommands(runtime);
    var spawnPreparation = SpawnPreparation.start(context, config);
    var kitItems = KitItems.build(config.kits());
    context
        .services()
        .provide(
            com.shepherdjerred.thestorm.essentials.app.StarterSupplies.class,
            kitItems.starter(config.kits().starter()));
    context
        .services()
        .provide(
            com.shepherdjerred.thestorm.core.home.DefaultHome.class,
            new PaperDefaultHome(
                app.stores().homes(), app.protection(), app.sealed(), config.homeLimit()));
    var kits =
        new PlayerCommands.Kits(
            config.kits(),
            app.stores().kitClaims(),
            new KitDeliveries(
                new KitDeliveries.Parts(
                    runtime, app.stores().kitClaims(), kitItems, context.plugin(), app.sealed())));
    var permissions = new EssentialsPermissions(server.getPluginManager());
    permissions.register();

    var teleports = config.teleports();
    var back =
        new BackRecorder(runtime, app.stores().back(), teleports.backHistorySize(), app.sealed());
    var destinations =
        context
            .services()
            .require(com.shepherdjerred.thestorm.essentials.app.RuntimeDestinations.class);
    var placements = new com.shepherdjerred.thestorm.essentials.app.NewcomerPlacements();
    context
        .services()
        .provide(com.shepherdjerred.thestorm.essentials.app.NewcomerPlacements.class, placements);
    var beds = new BedHomes();
    var flow =
        new TeleportFlow(
            runtime,
            new TeleportFlow.Services(
                app.payments(),
                app.guards(),
                app.protection(),
                back,
                app.sealed(),
                context
                    .services()
                    .require(com.shepherdjerred.thestorm.core.world.SpawnArrivals.class),
                destinations.spawn()),
            teleports.warmup());
    context
        .services()
        .provide(com.shepherdjerred.thestorm.essentials.app.TeleportTravel.class, flow);
    var tpa = new TpaDesk(context.time(), teleports.tpaRules());
    var staff =
        new StaffPaper(
            context,
            context.services().require(com.shepherdjerred.thestorm.essentials.app.StaffState.class),
            app,
            tpa);
    var safe = new SafeTracker();

    var teleportCommands =
        new TeleportCommands(
            runtime,
            flow,
            new TeleportCommands.Places(
                app.stores().homes(),
                app.warps(),
                app.stores().back(),
                app.protection(),
                app.sealed(),
                destinations,
                beds,
                homes),
            config);
    var tpaCommands =
        new TpaCommands(
            runtime,
            flow,
            tpa,
            new TpaCommands.Rollout(
                teleports.tpaTimeout(),
                context
                    .services()
                    .require(com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.class)));
    var teleportInfo = new TeleportInfoCommands(runtime, flow);
    var playerCommands =
        new PlayerCommands(
            runtime,
            KitItems.readable(config.rules()),
            KitItems.readable(config.kits().guide()),
            app.afk());
    var moderationCommands = new ModerationCommands(runtime, app.moderation(), app.players());
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> {
              var commands = event.registrar();
              teleportCommands.register(commands);
              tpaCommands.register(commands);
              teleportInfo.register(commands);
              playerCommands.register(commands);
              maintenance.register(commands);
              moderationCommands.register(commands);
              staff.register(commands);
            });

    var afkListener = new AfkListener(runtime, app.afk(), playerCommands);
    List<Listener> listeners =
        List.of(
            spawnPreparation,
            maintenance,
            new TeleportListener(
                runtime, flow, new TeleportListener.Places(back, safe, destinations, beds)),
            new BedListener(
                runtime,
                app.stores().homes(),
                beds,
                new BedListener.Policy(config.homeLimit(), homes)),
            new ReturnListener(
                context,
                runtime,
                new com.shepherdjerred.thestorm.essentials.adapter.db.JooqReturnCharges(
                    context.database()),
                flow),
            new BanListener(runtime, app.moderation()),
            new SessionListener(
                runtime,
                app.players(),
                new SessionListener.Presence(app.afk(), tpa, flow, safe),
                new SessionListener.Arrival(config.newcomerSpawn(), kits, placements)),
            afkListener);
    listeners.forEach(
        listener -> server.getPluginManager().registerEvents(listener, context.plugin()));
    var scheduler = context.scheduler();
    var backfill =
        new BedBackfill(
            new BedBackfill.Sources(
                runtime, app.stores().homes(), beds, app.savedRespawns(), app.sealed(), homes));
    backfill.start();
    var tasks =
        List.of(
            scheduler.repeatOnMainThread(SWEEP_EVERY, SWEEP_EVERY, afkListener::sweep),
            scheduler.repeatOnMainThread(SWEEP_EVERY, SWEEP_EVERY, tpaCommands::expire),
            backfill);
    return new EssentialsPaper(listeners, tasks, flow, permissions, staff);
  }

  /** Stops everything started here except commands, which Paper keeps until shutdown. */
  public void stop() {
    tasks.forEach(Cancellable::cancel);
    flow.cancelAll();
    listeners.forEach(HandlerList::unregisterAll);
    permissions.unregister();
    staff.stop();
  }
}
