package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import com.shepherdjerred.thestorm.essentials.app.TeleportGuards;
import com.shepherdjerred.thestorm.qol.app.CombatTracker;
import com.shepherdjerred.thestorm.qol.app.GraveRegistry;
import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import com.shepherdjerred.thestorm.qol.domain.config.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement;
import com.shepherdjerred.thestorm.qol.domain.sleep.SleepVote;
import com.shepherdjerred.thestorm.qol.domain.text.DurationText;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;

/**
 * Wires qol into Paper: listeners, commands, permissions, periodic checks and the teleport guard.
 */
public final class QolPaper {

  private static final Duration EVERY_SECOND = Duration.ofSeconds(1);
  private static final Duration GRAVE_SWEEP = Duration.ofSeconds(30);

  private final List<Listener> listeners;
  private final List<Cancellable> tasks;
  private final QolPermissions permissions;
  private final CombatTracker combat;

  private QolPaper(
      List<Listener> listeners,
      List<Cancellable> tasks,
      QolPermissions permissions,
      CombatTracker combat) {
    this.listeners = List.copyOf(listeners);
    this.tasks = List.copyOf(tasks);
    this.permissions = permissions;
    this.combat = combat;
  }

  /**
   * What qol works with.
   *
   * @param store grave storage
   * @param graves the graves in memory
   * @param combat combat tags
   * @param protection land protection, for chest sorting
   * @param guards essentials' teleport guards, for the combat guard
   * @param afk essentials' away status, for the sleep vote
   */
  public record App(
      GraveStore store,
      GraveRegistry graves,
      CombatTracker combat,
      Protection protection,
      TeleportGuards guards,
      AfkStatus afk) {}

  public static QolPaper start(ModuleContext context, QolConfig config, App app) {
    return start(context, config, app, GraveFace.OWNER);
  }

  /** {@link #start(ModuleContext, QolConfig, App)} with grave heads wearing {@code face}. */
  static QolPaper start(ModuleContext context, QolConfig config, App app, GraveFace face) {
    var server = context.plugin().getServer();
    var runtime = new QolRuntime(server, context.scheduler(), context.time(), context.logger());
    var permissions = new QolPermissions(server.getPluginManager());
    permissions.register();

    var policy = config.graves().policy();
    var parts =
        new GraveParts(
            app.store(),
            app.graves(),
            new GravePlacement(config.graves().searchRadius()),
            policy,
            face);
    var safe = new LastSafeSpots();
    var upkeep = new GraveUpkeep(runtime, parts);
    var deaths = new GraveDeaths(runtime, parts, safe, context.random());
    var opening = new GraveOpening(runtime, parts, upkeep);
    var sorting = new ContainerSorting(app.protection());
    var combat = new CombatListener(runtime, app.combat(), config.combat());
    var sleep =
        new SleepListener(
            runtime,
            new SleepVote(config.sleep().percent()),
            app.afk(),
            config.sleep().morningMessage());

    app.guards()
        .add(
            (mover, destination) ->
                app.combat()
                    .remaining(mover)
                    .map(
                        remaining ->
                            HouseStyle.error(
                                Say.COMBAT,
                                Component.text(
                                    "You cannot teleport while in combat ("
                                        + DurationText.of(remaining)
                                        + " left)."))));

    var commands = new QolCommands(runtime, app.graves(), policy, sorting);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> commands.register(event.registrar()));

    var listeners = new ArrayList<Listener>();
    listeners.add(new GraveListener(deaths, opening, upkeep, safe));
    listeners.add(new GraveShield());
    listeners.add(combat);
    listeners.add(sleep);
    if (config.sort().sneakPunch()) {
      listeners.add(new SortListener(sorting));
    }
    listeners.forEach(
        listener -> server.getPluginManager().registerEvents(listener, context.plugin()));

    var scheduler = context.scheduler();
    var tasks =
        List.of(
            scheduler.repeatOnMainThread(
                EVERY_SECOND, EVERY_SECOND, () -> server.getOnlinePlayers().forEach(safe::sample)),
            scheduler.repeatOnMainThread(EVERY_SECOND, EVERY_SECOND, combat::tick),
            scheduler.repeatOnMainThread(EVERY_SECOND, EVERY_SECOND, sleep::tick),
            scheduler.repeatOnMainThread(GRAVE_SWEEP, GRAVE_SWEEP, upkeep::sweep));
    upkeep.load();
    return new QolPaper(listeners, tasks, permissions, app.combat());
  }

  /**
   * Stops everything started here except commands, which Paper keeps until shutdown, and the
   * teleport guard, which cannot be removed and allows every teleport once the tags are cleared.
   */
  public void stop() {
    tasks.forEach(Cancellable::cancel);
    listeners.forEach(HandlerList::unregisterAll);
    permissions.unregister();
    combat.clearAll();
  }
}
