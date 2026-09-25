package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.essentials.app.AfkTracker;
import com.shepherdjerred.thestorm.essentials.app.GuardRegistry;
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
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;

/** Wires essentials into Paper: commands, listeners, permissions and periodic checks. */
public final class EssentialsPaper {

  private static final Duration SWEEP_EVERY = Duration.ofSeconds(5);

  private final List<Listener> listeners;
  private final List<Cancellable> tasks;
  private final TeleportFlow flow;
  private final EssentialsPermissions permissions;

  private EssentialsPaper(
      List<Listener> listeners,
      List<Cancellable> tasks,
      TeleportFlow flow,
      EssentialsPermissions permissions) {
    this.listeners = List.copyOf(listeners);
    this.tasks = List.copyOf(tasks);
    this.flow = flow;
    this.permissions = permissions;
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
   */
  public record App(
      TeleportPayments payments,
      GuardRegistry guards,
      AfkTracker afk,
      ModerationService moderation,
      PlayerDirectory players,
      WarpDirectory warps,
      Stores stores) {}

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
   * spawn world is not loaded.
   */
  public static EssentialsPaper start(ModuleContext context, EssentialsConfig config, App app) {
    var server = context.plugin().getServer();
    var runtime = new PaperRuntime(server, context.scheduler(), context.time(), context.logger());
    if (Positions.toLocation(server, config.spawn()).isEmpty()) {
      throw new IllegalStateException(
          "essentials.yml spawn names world '" + config.spawn().world() + "', which is not loaded");
    }
    var kits =
        new PlayerCommands.Kits(
            config.kits(), KitItems.build(config.kits()), app.stores().kitClaims());
    var permissions = new EssentialsPermissions(server.getPluginManager());
    permissions.register(config.kits().kits().keySet());

    var teleports = config.teleports();
    var back = new BackRecorder(runtime, app.stores().back(), teleports.backHistorySize());
    var flow =
        new TeleportFlow(
            runtime,
            new TeleportFlow.Services(app.payments(), app.guards(), back),
            teleports.warmup());
    var tpa = new TpaDesk(context.time(), teleports.tpaTimeout());

    var teleportCommands =
        new TeleportCommands(
            runtime,
            flow,
            new TeleportCommands.Places(app.stores().homes(), app.warps(), app.stores().back()),
            config);
    var tpaCommands = new TpaCommands(runtime, flow, tpa, teleports.tpaTimeout());
    var playerCommands =
        new PlayerCommands(runtime, kits, KitItems.readable(config.rules()), app.afk());
    var moderationCommands = new ModerationCommands(runtime, app.moderation(), app.players());
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> {
              var commands = event.registrar();
              teleportCommands.register(commands);
              tpaCommands.register(commands);
              playerCommands.register(commands);
              moderationCommands.register(commands);
            });

    var afkListener = new AfkListener(runtime, app.afk(), playerCommands);
    List<Listener> listeners =
        List.of(
            new TeleportListener(runtime, flow, back, config.spawn()),
            new BanListener(runtime, app.moderation()),
            new SessionListener(
                runtime,
                app.players(),
                new SessionListener.Presence(app.afk(), tpa, flow),
                new SessionListener.Arrival(config.spawn(), kits)),
            afkListener);
    listeners.forEach(
        listener -> server.getPluginManager().registerEvents(listener, context.plugin()));
    var scheduler = context.scheduler();
    var tasks =
        List.of(
            scheduler.repeatOnMainThread(SWEEP_EVERY, SWEEP_EVERY, afkListener::sweep),
            scheduler.repeatOnMainThread(SWEEP_EVERY, SWEEP_EVERY, tpaCommands::expire));
    return new EssentialsPaper(listeners, tasks, flow, permissions);
  }

  /** Stops everything started here except commands, which Paper keeps until shutdown. */
  public void stop() {
    tasks.forEach(Cancellable::cancel);
    flow.cancelAll();
    listeners.forEach(HandlerList::unregisterAll);
    permissions.unregister();
  }
}
